// 06 "Flows SB-1 to SB-5 and SB-11": each flow from createDeal to its terminal status with the full event trail.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { addFile, applyPaypalEvent, getEvidencePack, handle, tick } from "@/lib/deal";
import { captureKey, payoutBatchId, voidKey } from "@/lib/deal/keys";
import { assertEventsInC6, dealBuilder, dealRow, events, expectError, makeJpeg, parties, resetDb, testDeps, webhookEvent, type Parties, type TestDeps } from "./helpers";

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
const trail = async (code: string) => (await events(code)).map((e) => [e.cause, e.actor, e.to_status]);
const payoutSucceeded = (code: string, n = 1) =>
  applyPaypalEvent(webhookEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", { payout_item_id: `ITEM-${n}`, payout_batch_id: `BATCH-${n}`, payout_item: { sender_item_id: payoutBatchId(code, n) } }), deps);
const authVoided = (code: string) => applyPaypalEvent(webhookEvent("PAYMENT.AUTHORIZATION.VOIDED", { id: "AUTH-1", status: "VOIDED", custom_id: code }), deps);
const FAIL = (confidence: number) => [{ result: "fail" as const, confidence, reason: "Wrong item." }];

describe("SB-1 happy path", () => {
  test("create -> references -> join -> accept x2 -> pay -> evidence -> captured -> paid; 11-row trail; the evidence pack has every section", async () => {
    const code = await build.draft();
    const refs = [makeJpeg(1), makeJpeg(2)];
    for (const bytes of refs) await addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes }, deps);
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: "seller-pp@test" } }); // PATCH /api/me: no event
    await handle(code, p.asSeller, { type: "join" }, deps);
    await handle(code, p.asSeller, { type: "accept", terms_version: 1 }, deps);
    await handle(code, p.asBuyer, { type: "accept", terms_version: 1 }, deps);
    const v0 = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await handle(code, p.asBuyer, { type: "confirm_approval", order_id: v0.payment!.paypal_order_id }, deps);
    const v = await build.submit(code);

    expect(v.status).toBe("captured");
    expect(calls("captureAuthorization")).toEqual([{ op: "captureAuthorization", requestId: captureKey(code, 0), args: { authorization_id: "AUTH-1", amount_minor: 8000 } }]);
    expect((await dealRow(code)).payment).toMatchObject({ status: "captured", capture_id: "CAP-1" });
    expect((await dealRow(code)).payouts).toEqual([expect.objectContaining({ attempt: 1, sender_batch_id: payoutBatchId(code, 1), status: "pending", amount_minor: 8000 })]);
    const judgeInput = deps.ai.calls.find((c) => c.job === "judge")!.input as { reference_photos: { sha256: string }[] };
    expect(judgeInput.reference_photos).toHaveLength(2);

    expect((await payoutSucceeded(code)).outcome).toBe("applied");
    expect((await dealRow(code)).status).toBe("paid");
    expect((await applyPaypalEvent(webhookEvent("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-1", custom_id: code }), deps)).outcome).toBe("noop");

    const ev = await events(code);
    expect(ev.map((e) => [e.cause, e.actor, e.to_status])).toEqual([
      ["create", "buyer", "draft"], ["join", "seller", "draft"], ["accept", "seller", "draft"], ["accept", "buyer", "terms_agreed"],
      ["start_payment", "buyer", "terms_agreed"], ["fact:authorization_created", "paypal", "held"], ["submit_evidence", "seller", "proof_submitted"],
      ["verdict", "ai", "proof_submitted"], ["decision:capture", "system", "captured"], ["fact:capture_completed", "paypal", "captured"],
      ["fact:payout_succeeded", "paypal", "paid"],
    ]);
    expect(ev[5]!.payload).toMatchObject({ source: "api" });
    expect(ev[9]!.payload).toMatchObject({ source: "api", payout: { attempt: 1 } });
    expect(ev[10]!.payload).toMatchObject({ source: "webhook", paypal_event_id: "WH-1" });

    const pack = await getEvidencePack(code, p.asSeller, deps);
    expect(pack).toMatchObject({ format: "handshake-evidence-pack/1", generated_for: "seller", deal: { code, status: "paid" } });
    expect(pack.parties.seller).toMatchObject({ display_name: "Seller", paypal_email: "seller-pp@test" });
    expect(pack.conditions).toHaveLength(3);
    expect(pack.reference_files).toHaveLength(2);
    expect(pack.submissions[0]!.files).toHaveLength(2);
    expect(pack.submissions[0]!.verdicts.map((x) => [x.model, x.prompt_version, typeof x.raw_response])).toEqual(Array(3).fill(["fake", "judge-v1", "object"]));
    expect(pack.payment).toMatchObject({ paypal_order_id: "ORD-1", authorization_id: "AUTH-1", capture_id: "CAP-1" });
    expect(pack.payouts).toEqual([expect.objectContaining({ attempt: 1, status: "success", recipient_email: "seller-pp@test" })]);
    expect(pack.events).toHaveLength(11);
    expect(pack.webhook_events).toEqual([expect.objectContaining({ paypal_event_id: "WH-1", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", verified: true })]);
    expect(pack.extraction).toEqual({ model: "fake", prompt_version: "extract-v1", rejected: [] });
    expect(pack).not.toHaveProperty("evidence");
    expect(pack).not.toHaveProperty("verdicts");
  });
});

describe("SB-2 wrong item, no fix", () => {
  test("request_fix leaves held with fix_attempts_used 1 and no email; the deadline tick voids it; a later VOIDED webhook is a no-op", async () => {
    const code = await build.proofSubmitted(FAIL(0.92));
    expect(await dealRow(code)).toMatchObject({ status: "held", fix_attempts_used: 1 });
    expect((await trail(code)).slice(-3)).toEqual([["submit_evidence", "seller", "proof_submitted"], ["verdict", "ai", "proof_submitted"], ["decision:request_fix", "system", "held"]]);
    expect((await events(code)).at(-1)!.payload).toEqual({ submission_no: 1, reason: "fail" });
    expect(deps.email.sent).toEqual([]);
    expect(calls("voidAuthorization")).toHaveLength(0);

    deps.clock.set("2026-10-27T10:00:01Z");
    const report = await tick(deps.clock.now(), deps);
    expect(report).toEqual({ voided: [code], verdicts_rerun: [], reconciled: [], errors: [] });
    expect(calls("voidAuthorization")).toEqual([{ op: "voidAuthorization", requestId: voidKey(code), args: { authorization_id: "AUTH-1" } }]);
    expect(await dealRow(code)).toMatchObject({ status: "voided", payment: { status: "voided" } });
    const tail = (await events(code)).slice(-2);
    expect(tail[0]).toMatchObject({ from_status: "held", to_status: "voided", actor: "system", cause: "tick:deadline", payload: { deadline_at: "2026-10-27T10:00:00Z", authorization_id: "AUTH-1" } });
    expect(tail[1]).toMatchObject({ from_status: "voided", to_status: "voided", actor: "paypal", cause: "fact:authorization_voided", payload: { authorization_id: "AUTH-1", source: "api", paypal_request_id: voidKey(code) } });
    expect(deps.email.sent).toEqual([]);

    const n = (await events(code)).length;
    expect((await authVoided(code)).outcome).toBe("noop");
    expect(await events(code)).toHaveLength(n);
  });
});

describe("SB-3 wrong item, then fixed", () => {
  test("submission 2 passes -> captured -> paid with capture-{code}-0; a third submit is invalid_state", async () => {
    const code = await build.proofSubmitted(FAIL(0.92));
    deps.ai.judgeWith([]);
    const v = await build.submit(code);
    expect(v.status).toBe("captured");
    expect(v.submissions.map((s) => [s.submission_no, s.decision, s.decision_reason])).toEqual([[1, "request_fix", "fail"], [2, "capture", "all_pass"]]);
    expect(v.submissions[1]!.verdicts).toHaveLength(3);
    expect(await deps.db.evidence.count({ where: { deal: { public_code: code }, submission_no: 2 } })).toBe(3);
    expect(calls("captureAuthorization").map((c) => c.requestId)).toEqual([captureKey(code, 0)]);
    await payoutSucceeded(code);
    expect((await dealRow(code)).status).toBe("paid");
    await expectError(build.submit(code), "invalid_state");
  });

  test("D9: a second-submission fail at 0.40 goes to the buyer (reason fail); at 0.90 it voids", async () => {
    const low = await build.proofSubmitted(FAIL(0.92));
    deps.ai.judgeWith(FAIL(0.4));
    const v = await build.submit(low);
    expect(v).toMatchObject({ status: "in_review", fix_attempts_used: 1 });
    expect(v.submissions[1]).toMatchObject({ submission_no: 2, decision: "buyer_review", decision_reason: "fail" });
    expect((await events(low)).at(-1)).toMatchObject({ cause: "decision:buyer_review", to_status: "in_review", payload: { submission_no: 2, reason: "fail" } });
    expect(calls("voidAuthorization")).toHaveLength(0);
    expect(deps.email.sent).toEqual([expect.objectContaining({ to: "buyer@test", subject: `Your decision is needed on ${low}` })]);

    const high = await build.proofSubmitted(FAIL(0.92));
    deps.ai.judgeWith(FAIL(0.9));
    const v2 = await build.submit(high);
    expect(v2).toMatchObject({ status: "voided", payment: { status: "voided" } });
    expect(v2.submissions[1]).toMatchObject({ decision: "void", decision_reason: "fail" });
    expect(calls("voidAuthorization")).toEqual([{ op: "voidAuthorization", requestId: voidKey(high), args: { authorization_id: "AUTH-2" } }]);
    const tail = (await events(high)).slice(-2);
    expect(tail[0]).toMatchObject({ from_status: "proof_submitted", to_status: "voided", actor: "system", cause: "decision:void", payload: { submission_no: 2, reason: "fail", authorization_id: "AUTH-2" } });
    expect(tail[1]).toMatchObject({ cause: "fact:authorization_voided", payload: { source: "api", paypal_request_id: voidKey(high) } });
    expect((await authVoided(high)).outcome).toBe("noop");
  });
});

describe("SB-4 / SB-5 unclear", () => {
  test("SB-4: in_review, buyer emailed, no PayPal call; approve -> capture-{code}-0 -> captured -> paid", async () => {
    const code = await build.inReview();
    expect((await events(code)).at(-1)).toMatchObject({ cause: "decision:buyer_review", payload: { submission_no: 1, reason: "unclear" } });
    expect(deps.email.sent).toEqual([expect.objectContaining({ to: "buyer@test", subject: `Your decision is needed on ${code}` })]);
    expect(calls("captureAuthorization")).toHaveLength(0);
    expect(calls("voidAuthorization")).toHaveLength(0);

    const v = await handle(code, p.asBuyer, { type: "review", decision: "approve", note: null }, deps);
    expect(v.status).toBe("captured");
    expect(calls("captureAuthorization").map((c) => c.requestId)).toEqual([captureKey(code, 0)]);
    expect(calls("createPayout")).toHaveLength(1);
    await payoutSucceeded(code);
    expect((await dealRow(code)).status).toBe("paid");
    expect((await trail(code)).slice(-5)).toEqual([
      ["verdict", "ai", "proof_submitted"], ["decision:buyer_review", "system", "in_review"], ["review:approve", "buyer", "captured"],
      ["fact:capture_completed", "paypal", "captured"], ["fact:payout_succeeded", "paypal", "paid"],
    ]);
  });

  test("SB-5: reject -> void-{code} -> voided; no capture call ever", async () => {
    const code = await build.inReview();
    const v = await handle(code, p.asBuyer, { type: "review", decision: "reject", note: "Blurry, not convinced." }, deps);
    expect(v).toMatchObject({ status: "voided", payment: { status: "voided" } });
    expect(calls("voidAuthorization").map((c) => c.requestId)).toEqual([voidKey(code)]);
    expect(calls("captureAuthorization")).toHaveLength(0);
    expect((await trail(code)).slice(-2)).toEqual([["review:reject", "buyer", "voided"], ["fact:authorization_voided", "paypal", "voided"]]);
    expect((await authVoided(code)).outcome).toBe("noop");
  });
});

describe("SB-11 cancel before proof", () => {
  test("buyer cancels in held: voided, payment voided, one void; a later VOIDED webhook is a no-op", async () => {
    const code = await build.held();
    const v = await handle(code, p.asBuyer, { type: "cancel" }, deps);
    expect(v).toMatchObject({ status: "voided", payment: { status: "voided" } });
    expect(calls("voidAuthorization")).toEqual([{ op: "voidAuthorization", requestId: voidKey(code), args: { authorization_id: "AUTH-1" } }]);
    expect((await trail(code)).slice(-2)).toEqual([["cancel", "buyer", "voided"], ["fact:authorization_voided", "paypal", "voided"]]);
    const n = (await events(code)).length;
    expect((await authVoided(code)).outcome).toBe("noop");
    expect(await events(code)).toHaveLength(n);
  });

  test("seller cancels in terms_agreed with an unapproved order: voided, no PayPal call", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    const v = await handle(code, p.asSeller, { type: "cancel" }, deps);
    expect(v).toMatchObject({ status: "voided", payment: { status: "created", authorization_id: null } });
    expect(calls("voidAuthorization")).toHaveLength(0);
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "terms_agreed", to_status: "voided", actor: "seller", cause: "cancel", payload: { authorization_id: null, voided: false } });
  });
});
