// trust spec §7: the signed contract is re-verified before every money step. A change made straight in the database after
// both parties signed (amount, a condition, the title, the seller, a payout row) stops the step, records why, and moves no money.
import { beforeEach, describe, expect, test } from "vitest";
import { handle } from "@/lib/deal";
import { sealText } from "@/lib/deal/sealed";
import { prisma } from "@/lib/db";
import { dealBuilder, events, expectError, parties, resetDb, testDeps, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});

const ops = (op: string) => deps.paypal.calls.filter((c) => c.op === op);
const dealOf = (code: string) => prisma.deal.findUniqueOrThrow({ where: { public_code: code }, include: { conditions: { orderBy: { position: "asc" } }, payment: true, payouts: true } });
const failures = async (code: string) => (await events(code)).filter((e) => e.cause === "contract:verification_failed").map((e) => e.payload as { step: string; problem: string });

const tamper = {
  amount: (code: string) => prisma.deal.update({ where: { public_code: code }, data: { amount_minor: 1 } }),
  title: async (code: string) => {
    const d = await dealOf(code);
    await prisma.deal.update({ where: { id: d.id }, data: { item_title: sealText("deals.item_title", d.id, "A different item") } });
  },
  condition: async (code: string) => {
    const d = await dealOf(code);
    await prisma.condition.update({ where: { id: d.conditions[0]!.id }, data: { text: sealText("conditions.text", d.id, "Anything at all") } });
  },
  seller: (code: string) => prisma.deal.update({ where: { public_code: code }, data: { seller_id: p.third.id } }),
};

describe("before start_payment", () => {
  test.each(["amount", "title", "condition"] as const)("tampered %s: contract_invalid, no PayPal order, one audit event", async (what) => {
    const code = await build.agreed();
    await tamper[what](code);
    const e = await expectError(handle(code, p.asBuyer, { type: "start_payment" }, deps), "contract_invalid");
    expect(e.message).toMatch(/No money was moved/);
    expect(ops("createAuthorizeOrder")).toHaveLength(0);
    expect((await dealOf(code)).payment).toBeNull();
    expect(await failures(code)).toEqual([{ step: "start_payment", problem: "the terms differ from what the buyer signed" }]);
  });

  test("a swapped seller is caught for the buyer too (the seller field is part of what both signed)", async () => {
    const code = await build.agreed();
    await prisma.deal.update({ where: { public_code: code }, data: { seller_id: p.third.id } });
    await expectError(handle(code, p.asBuyer, { type: "start_payment" }, deps), "contract_invalid");
    expect(await failures(code)).toEqual([{ step: "start_payment", problem: "the terms differ from what the buyer signed" }]);
  });
});

describe("before confirm_approval", () => {
  test("the order exists, the terms change, the authorization is never requested", async () => {
    const code = await build.agreed();
    const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await tamper.amount(code);
    await expectError(handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps), "contract_invalid");
    expect(ops("authorizeOrder")).toHaveLength(0);
    expect((await dealOf(code)).status).toBe("terms_agreed");
    expect((await failures(code)).map((f) => f.step)).toEqual(["confirm_approval"]);
  });
});

describe("before capture", () => {
  test("automatic capture after passing proof: refused, the hold stays, the deal stays proof_submitted", async () => {
    const code = await build.held();
    await tamper.condition(code);
    deps.ai.judgeWith([]);
    await expectError(build.submit(code), "contract_invalid");
    expect(ops("captureAuthorization")).toHaveLength(0);
    expect(ops("voidAuthorization")).toHaveLength(0);
    const d = await dealOf(code);
    expect(d.status).toBe("proof_submitted");
    expect(d.payment!.status).toBe("authorized");
    expect((await failures(code)).map((f) => f.step)).toEqual(["capture"]);
  });

  test("the buyer's approve in review: refused, nothing captured", async () => {
    const code = await build.inReview();
    await tamper.amount(code);
    await expectError(handle(code, p.asBuyer, { type: "review", decision: "approve", note: null }, deps), "contract_invalid");
    expect(ops("captureAuthorization")).toHaveLength(0);
    expect((await dealOf(code)).status).toBe("in_review");
  });

  test("void paths are not gated: rejecting still releases the buyer's money", async () => {
    const code = await build.inReview();
    await tamper.amount(code);
    const v = await handle(code, p.asBuyer, { type: "review", decision: "reject", note: null }, deps);
    expect(v.status).toBe("voided");
    expect(ops("voidAuthorization")).toHaveLength(1);
  });
});

describe("before payout", () => {
  async function capturedWithUnsentPayout() {
    const code = await build.held();
    deps.paypal.failNext("createPayout", { status: 500, name: "INTERNAL_SERVER_ERROR" }); // the row stays pending with no batch id
    deps.ai.judgeWith([]);
    await build.submit(code);
    expect((await dealOf(code)).payouts).toMatchObject([{ status: "pending", paypal_batch_id: null }]);
    return code;
  }

  test("a payout row whose amount was changed is failed with CONTRACT_INVALID and never sent", async () => {
    const code = await capturedWithUnsentPayout();
    await prisma.payout.updateMany({ where: { deal: { public_code: code } }, data: { amount_minor: 999_999 } });
    const before = ops("createPayout").length;
    await handle(code, p.asSeller, { type: "retry_payout" }, deps);
    expect(ops("createPayout")).toHaveLength(before);
    expect((await dealOf(code)).payouts).toMatchObject([{ status: "failed", failure_reason: "CONTRACT_INVALID" }]);
    expect(await failures(code)).toEqual([{ step: "payout", problem: "the payout amount differs from the contract" }]);
  });

  test("a payout row redirected to another address is failed and never sent", async () => {
    const code = await capturedWithUnsentPayout();
    await prisma.payout.updateMany({ where: { deal: { public_code: code } }, data: { recipient_email: "attacker@test" } });
    await handle(code, p.asSeller, { type: "retry_payout" }, deps);
    expect(ops("createPayout").filter((c) => (c.args as { receiver: string }).receiver === "attacker@test")).toHaveLength(0);
    expect((await failures(code)).map((f) => f.problem)).toEqual(["the payout address is not the seller's verified PayPal email"]);
  });

  test("terms changed after capture: the retry is refused at the payout gate", async () => {
    const code = await capturedWithUnsentPayout();
    await tamper.title(code);
    await handle(code, p.asSeller, { type: "retry_payout" }, deps);
    expect((await dealOf(code)).payouts[0]).toMatchObject({ status: "failed", failure_reason: "CONTRACT_INVALID" });
  });
});
