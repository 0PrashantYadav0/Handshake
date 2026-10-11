// 06 "One per command" tick (module level; the bearer check is the route's), "SB-8 capture requested twice with one key" and
// "Server death during the verdict".
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyPaypalEvent, tick } from "@/lib/deal";
import { captureKey, voidKey } from "@/lib/deal/keys";
import { assertEventsInC6, dealBuilder, dealRow, events, expectError, parties, resetDb, testDeps, TRACKING, webhookEvent, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
const PAST = "2026-10-27T10:00:01Z"; // deadline_at is 2026-10-27T10:00:00Z for every held deal built at CLOCK_START

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});
afterEach(assertEventsInC6);

const calls = (op: string) => deps.paypal.calls.filter((c) => c.op === op);
const judgeCalls = () => deps.ai.calls.filter((c) => c.job === "judge").length;
const run = () => tick(deps.clock.now(), deps);
const causes = async (code: string) => (await events(code)).map((e) => e.cause);
/** The deal's updated_at is Prisma's wall clock, not deps.clock: set it relative to the test clock. */
const stuckFor = (code: string, ms: number) => deps.db.deal.update({ where: { public_code: code }, data: { updated_at: new Date(deps.clock.now().getTime() - ms) } });

/** A deal left proof_submitted by a PayPal capture timeout: verdict rows stored, no decision:* event (SB-8 first half). */
async function stuckWithVerdicts(): Promise<string> {
  const code = await build.held();
  deps.ai.judgeWith([]);
  deps.paypal.failNext("captureAuthorization", "timeout");
  await expectError(build.submit(code), "paypal_error");
  return code;
}

/** 06 "Server death": by hand, a held deal moved to proof_submitted with its evidence rows and submit_evidence event, no verdicts. */
async function diedBeforeJudging(): Promise<string> {
  const code = await build.held();
  const ids = await build.evidence(code, 2);
  const d = await dealRow(code);
  await deps.db.evidence.createMany({
    data: [
      ...ids.map((file_id, i) => ({ deal_id: d.id, submission_no: 1, kind: "photo" as const, position: i + 1, file_id, uploaded_by: p.seller.id })),
      { deal_id: d.id, submission_no: 1, kind: "tracking" as const, position: 0, value: TRACKING, uploaded_by: p.seller.id },
    ],
  });
  await deps.db.deal.update({ where: { id: d.id }, data: { status: "proof_submitted" } });
  await deps.db.dealEvent.create({
    data: { deal_id: d.id, from_status: "held", to_status: "proof_submitted", actor: "seller", cause: "submit_evidence", payload: { submission_no: 1, file_ids: ids, tracking_number: TRACKING, carrier_status: "delivered" } },
  });
  return code;
}

describe("tick", () => {
  test("voids overdue held and in_review deals with void-{code}; a failing void lands in errors and the next deal is still voided; a second run finds nothing", async () => {
    const a = await build.held();
    const b = await build.inReview();
    const fresh = await build.held();
    deps.clock.set(PAST);
    await deps.db.deal.update({ where: { public_code: fresh }, data: { deadline_at: new Date("2026-10-28T00:00:00Z") } });
    deps.paypal.failNext("voidAuthorization", { status: 500, name: "INTERNAL_SERVER_ERROR" });
    const sentBefore = deps.email.sent.length; // the in_review notice of b; a deadline void emails nobody (02 section 5.6)

    const r1 = await run();
    expect(r1.errors).toHaveLength(1);
    expect(r1.voided).toHaveLength(1);
    expect([...r1.voided, r1.errors[0]!.code].sort()).toEqual([a, b].sort());
    expect(r1.errors[0]!.message).toContain("INTERNAL_SERVER_ERROR");
    expect(r1.verdicts_rerun).toEqual([]);
    const failedCode = r1.errors[0]!.code;
    expect((await dealRow(failedCode)).status).toBe(failedCode === a ? "held" : "in_review");
    expect((await dealRow(r1.voided[0]!))).toMatchObject({ status: "voided", payment: { status: "voided" } });
    expect((await events(r1.voided[0]!)).slice(-2).map((e) => [e.cause, e.actor, e.from_status, e.to_status])).toEqual([
      ["tick:deadline", "system", r1.voided[0] === a ? "held" : "in_review", "voided"], ["fact:authorization_voided", "paypal", "voided", "voided"],
    ]);
    expect((await events(r1.voided[0]!)).at(-2)!.payload).toMatchObject({ deadline_at: "2026-10-27T10:00:00Z", authorization_id: expect.stringMatching(/^AUTH-/) });
    expect((await dealRow(fresh)).status).toBe("held");

    const r2 = await run();
    expect(r2).toEqual({ voided: [failedCode], verdicts_rerun: [], reconciled: [], errors: [] });
    expect(calls("voidAuthorization").map((c) => c.requestId).sort()).toEqual([voidKey(a), voidKey(b), voidKey(failedCode)].sort());
    expect(deps.email.sent).toHaveLength(sentBefore);

    expect(await run()).toEqual({ voided: [], verdicts_rerun: [], reconciled: [], errors: [] });
  });

  test("a deadline void refused as already captured takes the C4 path and is not reported as voided", async () => {
    const code = await build.held();
    deps.clock.set(PAST);
    deps.paypal.failNext("voidAuthorization", { status: 422, name: "AUTHORIZATION_ALREADY_CAPTURED" });
    expect(await run()).toEqual({ voided: [], verdicts_rerun: [], reconciled: [], errors: [] });
    expect(calls("captureAuthorization").map((c) => c.requestId)).toEqual([captureKey(code, 0)]);
    expect(await dealRow(code)).toMatchObject({ status: "held", payment: { status: "captured", capture_id: "CAP-1" } });
  });
});

describe("SB-8 capture requested twice with one key", () => {
  test("timeout on capture -> paypal_error with verdicts stored; tick re-sends capture-{code}-0, the fake returns CAP-1, one capture, one payout", async () => {
    const code = await stuckWithVerdicts();
    expect((await dealRow(code)).status).toBe("proof_submitted");
    expect(await deps.db.verdict.count({ where: { deal: { public_code: code } } })).toBe(3);
    expect((await causes(code)).filter((c) => c.startsWith("decision:"))).toEqual([]);
    expect(judgeCalls()).toBe(1);
    expect(deps.paypal.captures.size).toBe(1); // PayPal captured it; we never heard

    deps.clock.advance(121_000);
    await stuckFor(code, 121_000);
    const report = await run();
    expect(report).toEqual({ voided: [], verdicts_rerun: [code], reconciled: [], errors: [] });
    expect(judgeCalls()).toBe(1);
    expect(calls("captureAuthorization").map((c) => c.requestId)).toEqual([captureKey(code, 0), captureKey(code, 0)]);
    expect(deps.paypal.captures.size).toBe(1);
    const ev = await events(code);
    expect(ev.slice(-4).map((e) => [e.cause, e.actor, e.to_status])).toEqual([
      ["verdict", "ai", "proof_submitted"], ["tick:reverify", "system", "proof_submitted"], ["decision:capture", "system", "captured"], ["fact:capture_completed", "paypal", "captured"],
    ]);
    expect(ev.at(-2)!.payload).toMatchObject({ submission_no: 1, capture_id: "CAP-1", capture_status: "COMPLETED", paypal_request_id: captureKey(code, 0) });
    expect(ev.at(-3)!.payload).toEqual({ submission_no: 1 });
    expect(ev.filter((e) => e.cause === "fact:capture_completed")).toHaveLength(1);
    expect(ev.at(-1)!.payload).toMatchObject({ source: "api" });
    expect(await deps.db.payout.count({ where: { deal: { public_code: code } } })).toBe(1);
    expect(calls("createPayout")).toHaveLength(1);
    expect((await dealRow(code))).toMatchObject({ status: "captured", payment: { status: "captured", capture_id: "CAP-1" } });
  });

  test("capture AUTHORIZATION_VOIDED (422) during the verdict applies authorization_voided: the deal is voided, not stuck", async () => {
    const code = await build.held();
    deps.paypal.failNext("captureAuthorization", { status: 422, name: "AUTHORIZATION_VOIDED" });
    const v = await build.submit(code);
    expect(v).toMatchObject({ status: "voided", payment: { status: "voided" } });
    expect((await causes(code)).slice(-2)).toEqual(["verdict", "fact:authorization_voided"]);
  });
});

describe("Server death during the verdict", () => {
  test("stuck 3 min without verdicts -> judged once and captured; 60 s -> untouched; with verdicts -> decided with no new judge call", async () => {
    const dead = await diedBeforeJudging();
    const young = await diedBeforeJudging();
    const judged = await stuckWithVerdicts();
    await stuckFor(dead, 180_000);
    await stuckFor(young, 60_000);
    await stuckFor(judged, 180_000);
    expect(judgeCalls()).toBe(1);

    const report = await run();
    expect(report.errors).toEqual([]);
    expect(report.verdicts_rerun.sort()).toEqual([dead, judged].sort());
    expect(judgeCalls()).toBe(2);

    expect((await causes(dead)).slice(-5)).toEqual(["submit_evidence", "tick:reverify", "verdict", "decision:capture", "fact:capture_completed"]);
    expect(await deps.db.verdict.count({ where: { deal: { public_code: dead } } })).toBe(3);
    expect((await dealRow(dead)).status).toBe("captured");
    const input = deps.ai.calls.at(-1)!.input as { code: string; evidence_photos: unknown[]; tracking_number: string; carrier_status: string };
    expect(input).toMatchObject({ code: dead, tracking_number: TRACKING, carrier_status: "delivered" });
    expect(input.evidence_photos).toHaveLength(2);

    expect((await causes(young)).at(-1)).toBe("submit_evidence");
    expect((await dealRow(young)).status).toBe("proof_submitted");

    expect((await causes(judged)).slice(-4)).toEqual(["verdict", "tick:reverify", "decision:capture", "fact:capture_completed"]);
    expect((await dealRow(judged)).status).toBe("captured");

    // a PAYMENT.CAPTURE.COMPLETED that lands first moves the deal itself; tick then has nothing to re-run
    const late = await stuckWithVerdicts();
    await stuckFor(late, 180_000);
    const capId = calls("captureAuthorization").length; // CAP-n for the n-th capture in this test
    expect((await applyPaypalEvent(webhookEvent("PAYMENT.CAPTURE.COMPLETED", { id: `CAP-${capId}`, custom_id: late }), deps)).outcome).toBe("applied");
    expect((await dealRow(late)).status).toBe("captured");
    expect(await run()).toEqual({ voided: [], verdicts_rerun: [], reconciled: [], errors: [] });
    expect((await causes(late)).filter((c) => c.startsWith("decision:"))).toEqual([]);
  });
});
