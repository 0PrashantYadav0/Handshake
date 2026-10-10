import { expect, test } from "vitest";
import { fakePaypal } from "@/lib/paypal/fake";
import { PayPalError } from "@/lib/paypal/types";
import { fakeAi } from "@/lib/ai/fake";
import { fakeEmail } from "@/lib/email/console";
import { fixedClock } from "@/lib/clock";
import type { JudgeInput } from "@/lib/ai/types";

const judgeInput: JudgeInput = {
  code: "HS-ABCD",
  conditions: [
    { id: "c1", text: "Item matches the listing photos", evidence_type: "photo" },
    { id: "c2", text: "Tracking shows delivered", evidence_type: "tracking" },
    { id: "c3", text: "Photo shows the deal code HS-ABCD written by hand", evidence_type: "photo" },
  ],
  reference_photos: [],
  evidence_photos: [],
  tracking_number: null,
  carrier_status: null,
  note: null,
  submission_no: 1,
};

test("fakePaypal: repeated requestId returns the stored response and creates nothing", async () => {
  const pp = fakePaypal();
  const a = await pp.createAuthorizeOrder({ code: "HS-ABCD", amount_minor: 8000, description: "x" }, "order-HS-ABCD-1");
  const b = await pp.createAuthorizeOrder({ code: "HS-ABCD", amount_minor: 8000, description: "x" }, "order-HS-ABCD-1");
  expect(b).toBe(a);
  expect(a.paypal_order_id).toBe("ORD-1");
  expect(pp.orders.size).toBe(1);
  expect(pp.calls).toHaveLength(2);
});

test("fakePaypal: authorize expiration is 29 days after the clock", async () => {
  const pp = fakePaypal();
  const { paypal_order_id } = await pp.createAuthorizeOrder({ code: "HS-ABCD", amount_minor: 8000, description: "x" }, "order-HS-ABCD-1");
  const auth = await pp.authorizeOrder(paypal_order_id, "auth-HS-ABCD");
  expect(auth).toMatchObject({ authorization_id: "AUTH-1", status: "CREATED", expiration_time: "2026-11-18T10:00:00Z" });
});

test("fakePaypal: failNext('captureAuthorization','timeout') stores the capture then throws", async () => {
  const pp = fakePaypal();
  const { paypal_order_id } = await pp.createAuthorizeOrder({ code: "HS-ABCD", amount_minor: 8000, description: "x" }, "order-HS-ABCD-1");
  const { authorization_id } = await pp.authorizeOrder(paypal_order_id, "auth-HS-ABCD");
  pp.failNext("captureAuthorization", "timeout");
  const err = await pp.captureAuthorization(authorization_id, 8000, "capture-HS-ABCD-1").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PayPalError);
  expect((err as PayPalError).name_).toBe("timeout");
  expect(pp.captures.get("CAP-1")?.status).toBe("COMPLETED");
  expect(await pp.captureAuthorization(authorization_id, 8000, "capture-HS-ABCD-1")).toMatchObject({ capture_id: "CAP-1", status: "COMPLETED" });
  expect(pp.captures.size).toBe(1);
});

test("fakePaypal: void rules, payouts, webhook verification, event builder", async () => {
  const pp = fakePaypal();
  const { paypal_order_id } = await pp.createAuthorizeOrder({ code: "HS-ABCD", amount_minor: 8000, description: "x" }, "order-HS-ABCD-1");
  const { authorization_id } = await pp.authorizeOrder(paypal_order_id, "auth-HS-ABCD");
  pp.failNext("voidAuthorization", { status: 422, name: "PREVIOUSLY_VOIDED" });
  await expect(pp.voidAuthorization(authorization_id, "void-HS-ABCD")).resolves.toBeUndefined();
  pp.failNext("voidAuthorization", { status: 422, name: "AUTHORIZATION_ALREADY_CAPTURED" });
  await expect(pp.voidAuthorization(authorization_id, "void-HS-ABCD-2")).rejects.toMatchObject({ status: 422, name_: "AUTHORIZATION_ALREADY_CAPTURED" });

  const payout = { sender_batch_id: "payout-HS-ABCD-1", sender_item_id: "payout-HS-ABCD-1", receiver: "seller-pp@test", amount_minor: 8000, note: "n" };
  const p1 = await pp.createPayout(payout, "payout-HS-ABCD-1");
  const p2 = await pp.createPayout(payout, "other-key");
  expect(p2.payout_batch_id).toBe(p1.payout_batch_id);
  await pp.cancelPayoutItem("ITEM-1");
  expect(pp.payouts.get("BATCH-1")?.cancelled).toBe(true);

  expect(await pp.verifyWebhook("{}", {})).toEqual({ result: "verified", webhook_id: "WEBHOOK_ID" });
  pp.failNext("verifyWebhook", "timeout");
  expect((await pp.verifyWebhook("{}", {})).result).toBe("unverified");

  const ev = pp.event("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-1", custom_id: "HS-ABCD" });
  expect(ev).toMatchObject({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource_type: "capture", verified: true, resource: { custom_id: "HS-ABCD" } });
});

test("fakePaypal: hangUntil delays the next call of that op", async () => {
  const pp = fakePaypal();
  let release!: () => void;
  pp.hangUntil("createAuthorizeOrder", new Promise<void>((r) => (release = r)));
  let done = false;
  const call = pp.createAuthorizeOrder({ code: "HS-ABCD", amount_minor: 1, description: "x" }, "k").then(() => (done = true));
  await Promise.resolve();
  expect(done).toBe(false);
  release();
  await call;
  expect(done).toBe(true);
});

test("fakeAi: defaults and judgeWith('missing_c2')", async () => {
  const ai = fakeAi();
  const ex = await ai.extract({ sentence: "x", today: new Date() });
  expect(ex.item_title).toBe("Hand-painted denim jacket");
  expect(ex.conditions).toHaveLength(2);
  const ok = await ai.judge(judgeInput);
  expect(ok.verdicts.map((v) => [v.condition_id, v.result, v.confidence])).toEqual([["c1", "pass", 0.95], ["c2", "pass", 0.95], ["c3", "pass", 0.95]]);
  ai.judgeWith("missing_c2");
  const out = await ai.judge(judgeInput);
  expect(out.verdicts[1]).toMatchObject({ condition_id: "c2", result: "unclear", confidence: 0, reason: "The AI returned no verdict for this condition." });
  expect(out.verdicts[0]?.result).toBe("pass");
  ai.judgeWith("timeout");
  const t = await ai.judge(judgeInput);
  expect(t.verdicts.every((v) => v.result === "unclear" && v.reason === "The AI did not answer in time.")).toBe(true);
  expect(t.raw_response).toMatchObject({ error: { kind: "timeout" } });
  ai.extractWith("refusal");
  await expect(ai.extract({ sentence: "x", today: new Date() })).rejects.toMatchObject({ code: "ai_unavailable" });
  expect(ai.calls.map((c) => c.job)).toEqual(["extract", "judge", "judge", "judge", "extract"]);
});

test("fakeEmail records; fixedClock advances", async () => {
  const email = fakeEmail();
  await email.send({ to: "buyer@test", subject: "Hi", text: "body" });
  expect(email.sent).toEqual([{ to: "buyer@test", subject: "Hi", text: "body" }]);

  const clock = fixedClock("2026-10-20T10:00:00Z");
  expect(clock.now().toISOString()).toBe("2026-10-20T10:00:00.000Z");
  clock.advance(7 * 86_400_000);
  expect(clock.now().toISOString()).toBe("2026-10-27T10:00:00.000Z");
  clock.set("2026-11-01T00:00:00Z");
  expect(clock.now().toISOString()).toBe("2026-11-01T00:00:00.000Z");
});
