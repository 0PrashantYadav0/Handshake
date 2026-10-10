// T-34: the seed is idempotent, obeys the CHECKs (inserts would fail otherwise), chains events (C2) and renders through lib/deal.
import { beforeEach, describe, expect, test } from "vitest";
import { getDeal, listDeals } from "@/lib/deal";
import { seed } from "../../prisma/seed";
import { resetDb, testDeps, type TestDeps } from "./helpers";

let deps: TestDeps;
beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  process.env.DEMO_SELLER_PAYPAL_EMAIL = "demo-seller-pp@test";
});

const counts = async (db: TestDeps["db"]) => ({
  users: await db.user.count(), deals: await db.deal.count({ where: { seeded: true } }),
  events: await db.dealEvent.count(), verdicts: await db.verdict.count(), conditions: await db.condition.count(),
});

describe("npm run seed", () => {
  test("writes two personas and 25 historical deals across every status but proof_submitted, and is idempotent", async () => {
    const first = await seed(deps.db);
    expect(first).toEqual({ users: 2, deals: 25 });
    const after1 = await counts(deps.db);
    expect(after1.users).toBe(2);
    expect(after1.deals).toBe(25);
    expect(await deps.db.deal.count()).toBe(25);
    expect(await deps.db.payment.count()).toBe(0);
    expect(await deps.db.evidence.count()).toBe(0);
    expect(await deps.db.file.count()).toBe(0);

    const seller = await deps.db.user.findUniqueOrThrow({ where: { email: "demo-seller@handshake.demo" } });
    expect(seller).toMatchObject({ display_name: "Demo Seller", paypal_email: "demo-seller-pp@test" });

    const byStatus = await deps.db.deal.groupBy({ by: ["status"], _count: true });
    const dist = Object.fromEntries(byStatus.map((r) => [r.status, r._count]));
    expect(dist).toEqual({ draft: 3, terms_agreed: 2, held: 4, in_review: 2, captured: 2, paid: 8, voided: 4 });
    expect(dist.proof_submitted).toBeUndefined();

    // Spread over the 60 days before now; updated_at is the last event.
    const dates = await deps.db.deal.findMany({ select: { created_at: true }, orderBy: { created_at: "asc" } });
    const spanDays = (dates.at(-1)!.created_at.getTime() - dates[0].created_at.getTime()) / 86_400_000;
    expect(spanDays).toBeGreaterThan(50);
    expect(spanDays).toBeLessThan(61);

    // C2 chaining and C6 actors per deal.
    const deals = await deps.db.deal.findMany({ include: { events: { orderBy: { id: "asc" } }, verdicts: true, conditions: true } });
    for (const d of deals) {
      expect(d.events.length).toBeGreaterThan(0);
      expect(d.events[0]).toMatchObject({ from_status: null, to_status: "draft", cause: "create", actor: "buyer" });
      d.events.slice(1).forEach((e, n) => expect(e.from_status).toBe(d.events[n].to_status));
      expect(d.events.at(-1)!.to_status).toBe(d.status);
      expect(d.updated_at.getTime()).toBe(d.events.at(-1)!.created_at.getTime());
      for (const e of d.events) {
        expect((e.payload as { seeded: boolean }).seeded).toBe(true);
        if (e.cause.startsWith("fact:")) expect(e.actor).toBe("paypal");
        if (e.cause === "verdict") expect(e.actor).toBe("ai");
        if (e.cause.startsWith("decision:") || e.cause.startsWith("tick:")) expect(e.actor).toBe("system");
      }
      expect(d.conditions.length).toBeGreaterThanOrEqual(2);
      expect(d.conditions.length).toBeLessThanOrEqual(4);
      expect(d.conditions.at(-1)!.text).toBe(`Photo shows the deal code ${d.public_code} written by hand`);
      const judged = d.events.filter((e) => e.cause === "verdict").length;
      expect(d.verdicts.length).toBe(judged * d.conditions.length);
      for (const v of d.verdicts) expect(v).toMatchObject({ model: "seed", prompt_version: "judge-v1", evidence_used: [], raw_response: { seeded: true } });
      expect(d.fix_attempts_used).toBe(judged === 2 ? 1 : 0);
    }

    // Second run: only the persona upsert changes.
    process.env.DEMO_SELLER_PAYPAL_EMAIL = "";
    const second = await seed(deps.db);
    expect(second).toEqual({ users: 2, deals: 25 });
    expect(await counts(deps.db)).toEqual(after1);
    expect((await deps.db.user.findUniqueOrThrow({ where: { email: "demo-seller@handshake.demo" } })).paypal_email).toBeNull();
  });

  test("listDeals and getDeal render seeded deals for the demo buyer without photos or payments", async () => {
    await seed(deps.db);
    const buyer = await deps.db.user.findUniqueOrThrow({ where: { email: "demo-buyer@handshake.demo" } });
    const rows = await listDeals({ user_id: buyer.id }, deps);
    expect(rows).toHaveLength(25);
    expect(rows.every((r) => r.seeded && r.role === "buyer" && r.last_event_cause)).toBe(true);
    expect(rows.some((r) => r.lowest_confidence !== null && r.lowest_confidence < 0.85)).toBe(true);
    const paid = rows.find((r) => r.status === "paid")!;
    const view = await getDeal(paid.code, { user_id: buyer.id }, deps);
    expect(view).toMatchObject({ role: "buyer", status: "paid", seeded: true, payment: null, payouts: [], reference_files: [] });
    if (view.role !== "buyer") throw new Error("expected a DealView");
    expect(view.submissions).toHaveLength(1);
    expect(view.submissions[0]).toMatchObject({ decision: "capture", decision_reason: null, files: [], carrier_status: null });
    expect(view.submissions[0].verdicts.length).toBe(view.conditions.length);
  });
});
