// Reconciliation (trust-and-accounts spec section 9; E12): each stuck state is driven with the fakes and no webhook, PayPal
// moves on in the fake, the clock passes the threshold and tick() applies the fact the webhook would have (the end states
// match webhooks.int.test.ts). The webhook that arrives afterwards changes nothing. Also: under the threshold, PayPal
// errors, seeded deals, and a webhook racing the reconcile.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyPaypalEvent, handle, tick } from "@/lib/deal";
import { payoutBatchId } from "@/lib/deal/keys";
import { APPROVED_HOLD_MS, CAPTURE_PENDING_MS, PAYOUT_PENDING_MS } from "@/lib/deal/reconcile";
import type { PayoutItemStatus } from "@/lib/paypal/types";
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

const run = () => tick(deps.clock.now(), deps);
const calls = (op: string) => deps.paypal.calls.filter((c) => c.op === op);
const getCalls = () => deps.paypal.calls.filter((c) => c.op.startsWith("get"));
const facts = async (code: string) => (await events(code)).filter((e) => e.cause.startsWith("fact:"));
const EMPTY = { voided: [], verdicts_rerun: [], reconciled: [], errors: [] };

/** updated_at is Prisma's wall clock, not deps.clock: stamp the deal's payment and payouts with the test clock's now. */
async function touch(code: string): Promise<void> {
  const d = await dealRow(code);
  const updated_at = deps.clock.now();
  if (d.payment) await deps.db.payment.update({ where: { id: d.payment.id }, data: { updated_at } });
  await deps.db.payout.updateMany({ where: { deal_id: d.id }, data: { updated_at } });
}

/** captured with payments.status capture_pending (CAP-n PENDING at PayPal), no payout: the API path's PENDING answer. */
async function capturePending(): Promise<string> {
  deps.paypal.captureStatus = "PENDING";
  const code = await build.captured();
  deps.paypal.captureStatus = "COMPLETED";
  expect(await dealRow(code)).toMatchObject({ status: "captured", payment: { status: "capture_pending" }, payouts: [] });
  await touch(code);
  return code;
}

/** captured with CAP-n COMPLETED and payout attempt 1 sent: pending with paypal_batch_id BATCH-n. */
async function payoutPending(): Promise<string> {
  const code = await build.captured();
  expect((await dealRow(code)).payouts[0]).toMatchObject({ status: "pending", paypal_batch_id: expect.stringMatching(/^BATCH-/) });
  await touch(code);
  return code;
}

/** terms_agreed with a PENDING authorization stored (payments approved, AUTH-n): confirm_approval answered paypal_error. */
async function approvedHold(): Promise<string> {
  const code = await build.agreed();
  const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
  deps.paypal.authorizeStatus = "PENDING";
  await expectError(handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps), "paypal_error");
  deps.paypal.authorizeStatus = "CREATED";
  expect(await dealRow(code)).toMatchObject({ status: "terms_agreed", payment: { status: "approved", authorization_id: expect.stringMatching(/^AUTH-/) } });
  await touch(code);
  return code;
}

const captureId = async (code: string) => (await dealRow(code)).payment!.capture_id!;
const authId = async (code: string) => (await dealRow(code)).payment!.authorization_id!;
const batchOf = async (code: string) => (await dealRow(code)).payouts[0]!.paypal_batch_id!;
const capRes = (id: string, code: string, reason?: string) => ({ id, custom_id: code, ...(reason ? { status_details: { reason } } : {}) });

describe("capture_pending past 10 minutes", () => {
  test("COMPLETED at PayPal: payment captured, one payout created and sent, fact with source reconcile; the late webhook is a no-op", async () => {
    const code = await capturePending();
    const cap = await captureId(code);
    deps.paypal.captures.get(cap)!.status = "COMPLETED";
    deps.clock.advance(CAPTURE_PENDING_MS + 1000);

    expect(await run()).toEqual({ ...EMPTY, reconciled: [code] });
    expect(calls("getCapture")).toEqual([{ op: "getCapture", requestId: null, args: { capture_id: cap } }]);
    const row = await dealRow(code);
    expect(row).toMatchObject({ status: "captured", payment: { status: "captured", capture_id: cap } });
    expect(row.payouts).toHaveLength(1);
    expect(row.payouts[0]).toMatchObject({ attempt: 1, sender_batch_id: payoutBatchId(code, 1), status: "pending", amount_minor: 8000, recipient_email: "seller-pp@test" });
    expect(row.payouts[0]!.paypal_batch_id).not.toBeNull(); // sendPayout ran after commit
    expect(calls("createPayout")).toHaveLength(1);
    const last = (await events(code)).at(-1)!;
    expect(last).toMatchObject({ from_status: "captured", to_status: "captured", actor: "paypal", cause: "fact:capture_completed", payload: { capture_id: cap, source: "reconcile", payout: { attempt: 1 } } });
    expect(last.payload).not.toHaveProperty("paypal_event_id");

    const n = (await events(code)).length;
    expect(await applyPaypalEvent(webhookEvent("PAYMENT.CAPTURE.COMPLETED", capRes(cap, code)), deps)).toEqual({ outcome: "noop" });
    expect(await events(code)).toHaveLength(n);
    expect((await dealRow(code)).payouts).toHaveLength(1);
    expect(calls("createPayout")).toHaveLength(1);
    expect(await run()).toEqual(EMPTY);
    expect(calls("getCapture")).toHaveLength(1);
  });

  test("DECLINED at PayPal: captured -> in_review, payment declined, capture_attempts 1, both emailed; the late webhook is a no-op", async () => {
    const code = await capturePending();
    const cap = await captureId(code);
    deps.paypal.captures.get(cap)!.status = "DECLINED";
    deps.clock.advance(CAPTURE_PENDING_MS + 1000);
    const sent = deps.email.sent.length;

    expect(await run()).toEqual({ ...EMPTY, reconciled: [code] });
    expect(await dealRow(code)).toMatchObject({ status: "in_review", payment: { status: "declined", capture_attempts: 1 }, payouts: [] });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "captured", to_status: "in_review", cause: "fact:capture_declined", payload: { capture_id: cap, reason: "DECLINED", source: "reconcile" } });
    expect(deps.email.sent.slice(sent).map((m) => m.to).sort()).toEqual(["buyer@test", "seller@test"]);

    const n = (await events(code)).length;
    expect(await applyPaypalEvent(webhookEvent("PAYMENT.CAPTURE.DECLINED", capRes(cap, code, "DECLINED")), deps)).toEqual({ outcome: "noop" });
    expect(await events(code)).toHaveLength(n);
    expect(deps.email.sent.length).toBe(sent + 2);
  });

  test("still PENDING at PayPal: nothing written, checked again on the next run", async () => {
    const code = await capturePending();
    const n = (await events(code)).length;
    deps.clock.advance(CAPTURE_PENDING_MS + 1000);
    expect(await run()).toEqual(EMPTY);
    expect(await events(code)).toHaveLength(n);
    expect((await dealRow(code)).payment!.status).toBe("capture_pending");
    expect(await run()).toEqual(EMPTY);
    expect(calls("getCapture")).toHaveLength(2);
  });
});

describe("payout pending with a batch id past 30 minutes", () => {
  test("SUCCESS at PayPal: row success with the item id, captured -> paid; the late webhook is a no-op and no second payout", async () => {
    const code = await payoutPending();
    const batch = await batchOf(code);
    deps.paypal.payouts.get(batch)!.itemStatus = "SUCCESS";
    deps.clock.advance(PAYOUT_PENDING_MS + 1000);

    expect(await run()).toEqual({ ...EMPTY, reconciled: [code] });
    expect(calls("getPayoutBatch")).toEqual([{ op: "getPayoutBatch", requestId: null, args: { payout_batch_id: batch } }]);
    const row = await dealRow(code);
    expect(row.status).toBe("paid");
    expect(row.payouts).toHaveLength(1);
    expect(row.payouts[0]).toMatchObject({ status: "success", paypal_batch_id: batch, paypal_item_id: deps.paypal.payouts.get(batch)!.itemId });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "captured", to_status: "paid", actor: "paypal", cause: "fact:payout_succeeded", payload: { attempt: 1, sender_item_id: payoutBatchId(code, 1), source: "reconcile" } });

    const n = (await events(code)).length;
    const res = { payout_item_id: deps.paypal.payouts.get(batch)!.itemId, payout_batch_id: batch, transaction_status: "SUCCESS", payout_item: { sender_item_id: payoutBatchId(code, 1) } };
    expect(await applyPaypalEvent(webhookEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", res), deps)).toEqual({ outcome: "noop" });
    expect(await events(code)).toHaveLength(n);
    expect(calls("createPayout")).toHaveLength(1);
    expect(await run()).toEqual(EMPTY);
  });

  test("FAILED with errors.name, BLOCKED, RETURNED, UNCLAIMED: row failed with the webhook's reason and the item id kept, deal stays captured; the late webhook is a no-op", async () => {
    for (const [status, errorName, reason, type] of [
      ["FAILED", "RECEIVER_ACCOUNT_INVALID", "RECEIVER_ACCOUNT_INVALID", "PAYMENT.PAYOUTS-ITEM.FAILED"],
      ["BLOCKED", undefined, "BLOCKED", "PAYMENT.PAYOUTS-ITEM.BLOCKED"],
      ["RETURNED", undefined, "RETURNED", "PAYMENT.PAYOUTS-ITEM.RETURNED"],
      ["UNCLAIMED", "SOMETHING", "UNCLAIMED", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED"],
    ] as const) {
      const code = await payoutPending();
      const batch = await batchOf(code);
      const fake = deps.paypal.payouts.get(batch)!;
      Object.assign(fake, { itemStatus: status as PayoutItemStatus, errorName });
      deps.clock.advance(PAYOUT_PENDING_MS + 1000);

      expect(await run()).toEqual({ ...EMPTY, reconciled: [code] });
      const row = await dealRow(code);
      expect(row.status).toBe("captured");
      expect(row.payouts[0]).toMatchObject({ status: "failed", failure_reason: reason, paypal_item_id: fake.itemId, paypal_batch_id: batch });
      expect((await events(code)).at(-1)).toMatchObject({ from_status: "captured", to_status: "captured", cause: "fact:payout_failed", payload: { failure_reason: reason, attempt: 1, source: "reconcile" } });

      const n = (await events(code)).length;
      const res = { payout_item_id: fake.itemId, payout_batch_id: batch, payout_item: { sender_item_id: payoutBatchId(code, 1) }, ...(errorName ? { errors: { name: errorName } } : {}) };
      expect(await applyPaypalEvent(webhookEvent(type, res), deps)).toEqual({ outcome: "noop" });
      expect(await events(code)).toHaveLength(n);
    }
    expect(deps.email.sent).toHaveLength(0);
  });

  test("still PENDING at PayPal: nothing written", async () => {
    const code = await payoutPending();
    const n = (await events(code)).length;
    deps.clock.advance(PAYOUT_PENDING_MS + 1000);
    expect(await run()).toEqual(EMPTY);
    expect(calls("getPayoutBatch")).toHaveLength(1);
    expect(await events(code)).toHaveLength(n);
    expect((await dealRow(code)).payouts[0]!.status).toBe("pending");
  });
});

describe("approved with a PENDING authorization past 10 minutes", () => {
  test("CREATED at PayPal: terms_agreed -> held, payment authorized, deadline set; the late AUTHORIZATION.CREATED is a no-op", async () => {
    const code = await approvedHold();
    const auth = await authId(code);
    deps.paypal.authorizations.get(auth)!.status = "CREATED";
    deps.clock.advance(APPROVED_HOLD_MS + 1000);

    expect(await run()).toEqual({ ...EMPTY, reconciled: [code] });
    expect(calls("getAuthorization")).toEqual([{ op: "getAuthorization", requestId: null, args: { authorization_id: auth } }]);
    const row = await dealRow(code);
    expect(row).toMatchObject({ status: "held", payment: { status: "authorized", authorization_id: auth } });
    expect(row.deadline_at!.getTime()).toBeGreaterThan(deps.clock.now().getTime());
    const exp = deps.paypal.authorizations.get(auth)!.expiration_time!;
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "terms_agreed", to_status: "held", actor: "paypal", cause: "fact:authorization_created", payload: { authorization_id: auth, auth_expires_at: exp, source: "reconcile" } });

    const n = (await events(code)).length;
    const res = { id: auth, status: "CREATED", custom_id: code, expiration_time: exp };
    expect(await applyPaypalEvent(webhookEvent("PAYMENT.AUTHORIZATION.CREATED", res), deps)).toEqual({ outcome: "noop" });
    expect(await events(code)).toHaveLength(n);
    expect(calls("voidAuthorization")).toHaveLength(0);
    expect(await run()).toEqual(EMPTY);
  });

  test("VOIDED or DENIED at PayPal: terms_agreed -> voided, payment voided, no void call; the late AUTHORIZATION.VOIDED is a no-op", async () => {
    for (const status of ["VOIDED", "DENIED"] as const) {
      const code = await approvedHold();
      const auth = await authId(code);
      deps.paypal.authorizations.get(auth)!.status = status;
      deps.clock.advance(APPROVED_HOLD_MS + 1000);

      expect(await run()).toEqual({ ...EMPTY, reconciled: [code] });
      expect(await dealRow(code)).toMatchObject({ status: "voided", payment: { status: "voided", authorization_id: auth } });
      expect((await events(code)).at(-1)).toMatchObject({ from_status: "terms_agreed", to_status: "voided", actor: "paypal", cause: "fact:authorization_voided", payload: { authorization_id: auth, source: "reconcile" } });

      const n = (await events(code)).length;
      expect(await applyPaypalEvent(webhookEvent("PAYMENT.AUTHORIZATION.VOIDED", { id: auth, status: "VOIDED", custom_id: code }), deps)).toEqual({ outcome: "noop" });
      expect(await events(code)).toHaveLength(n);
    }
    expect(calls("voidAuthorization")).toHaveLength(0);
  });

  test("still PENDING at PayPal: nothing written; held deals and payments without an authorization id are never asked", async () => {
    const pending = await approvedHold();
    const held = await build.held();
    const noAuth = await build.agreed(); // approved by Tx 1, authorizeOrder died: no authorization id to ask about
    await handle(noAuth, p.asBuyer, { type: "start_payment" }, deps);
    const d = await dealRow(noAuth);
    await deps.db.payment.update({ where: { id: d.payment!.id }, data: { status: "approved" } });
    for (const c of [pending, held, noAuth]) await touch(c);
    deps.clock.advance(APPROVED_HOLD_MS + 1000);

    expect(await run()).toEqual(EMPTY);
    expect(calls("getAuthorization").map((c) => c.args)).toEqual([{ authorization_id: await authId(pending) }]);
    expect((await dealRow(pending)).status).toBe("terms_agreed");
  });
});

describe("thresholds, errors, seeded deals, races", () => {
  test("under the threshold nothing is asked; past it the same deals are reconciled", async () => {
    const cap = await capturePending();
    const pay = await payoutPending();
    const hold = await approvedHold();
    deps.paypal.captures.get(await captureId(cap))!.status = "COMPLETED";
    deps.paypal.payouts.get(await batchOf(pay))!.itemStatus = "SUCCESS";
    deps.paypal.authorizations.get(await authId(hold))!.status = "CREATED";

    deps.clock.advance(CAPTURE_PENDING_MS - 1000);
    expect(await run()).toEqual(EMPTY);
    expect(getCalls()).toHaveLength(0);

    deps.clock.advance(2000); // capture and hold past 10 minutes, payout not yet past 30
    expect((await run()).reconciled.sort()).toEqual([cap, hold].sort());
    expect(calls("getPayoutBatch")).toHaveLength(0);
    expect((await dealRow(pay)).status).toBe("captured");

    deps.clock.advance(PAYOUT_PENDING_MS - CAPTURE_PENDING_MS);
    // cap's attempt-1 payout (created by the reconcile above) is still PENDING at PayPal: only pay moves
    expect(await run()).toEqual({ ...EMPTY, reconciled: [pay] });
    expect(await dealRow(pay)).toMatchObject({ status: "paid" });
  });

  test("a PayPal error on one deal lands in errors and the other deals are still reconciled; the next run picks it up", async () => {
    const a = await capturePending();
    const b = await capturePending();
    const hold = await approvedHold();
    for (const c of [a, b]) deps.paypal.captures.get(await captureId(c))!.status = "COMPLETED";
    deps.paypal.authorizations.get(await authId(hold))!.status = "CREATED";
    deps.clock.advance(PAYOUT_PENDING_MS + 1000);
    deps.paypal.failNext("getCapture", { status: 500, name: "INTERNAL_SERVER_ERROR" });

    const r1 = await run();
    expect(r1.errors).toHaveLength(1);
    expect(r1.errors[0]!.message).toBe("PayPal read failed: INTERNAL_SERVER_ERROR (debug_id FAKE-DEBUG)");
    const failed = r1.errors[0]!.code;
    expect([a, b]).toContain(failed);
    expect(r1.reconciled.sort()).toEqual([[a, b].find((c) => c !== failed)!, hold].sort());
    expect((await dealRow(failed)).payment!.status).toBe("capture_pending");
    expect((await facts(failed)).filter((e) => e.cause === "fact:capture_completed")).toHaveLength(0);

    expect(await run()).toEqual({ ...EMPTY, reconciled: [failed] });
    expect((await dealRow(failed)).payment!.status).toBe("captured");
    expect(calls("createPayout")).toHaveLength(2);
  });

  test("seeded deals are never asked about", async () => {
    const codes = [await capturePending(), await payoutPending(), await approvedHold()];
    await deps.db.deal.updateMany({ where: { public_code: { in: codes } }, data: { seeded: true } });
    deps.clock.advance(PAYOUT_PENDING_MS + 1000);
    expect(await run()).toEqual(EMPTY);
    expect(getCalls()).toHaveLength(0);
  });

  test("a webhook landing while reconcile waits on PayPal: one fact, from the webhook; the reconcile is a no-op", async () => {
    const code = await capturePending();
    const cap = await captureId(code);
    deps.paypal.captures.get(cap)!.status = "COMPLETED";
    deps.clock.advance(CAPTURE_PENDING_MS + 1000);
    let release!: () => void;
    deps.paypal.hangUntil("getCapture", new Promise<void>((r) => (release = r)));

    const ticking = run();
    const e = webhookEvent("PAYMENT.CAPTURE.COMPLETED", capRes(cap, code));
    expect(await applyPaypalEvent(e, deps)).toEqual({ outcome: "applied" });
    release();
    expect(await ticking).toEqual(EMPTY);

    const completed = (await facts(code)).filter((x) => x.cause === "fact:capture_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]!.payload).toMatchObject({ source: "webhook", paypal_event_id: e.id });
    expect((await dealRow(code)).payouts).toHaveLength(1);
    expect(calls("createPayout")).toHaveLength(1);
  });
});
