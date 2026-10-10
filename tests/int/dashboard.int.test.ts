// T-36: GET /api/dashboard/data through the real handler (06 "One per command" dashboard row; "Access rules"):
// 200 with only the caller's deals and the 04 section 14 keys, no emails or names; signed out -> 401.
import { beforeEach, describe, expect, test } from "vitest";
import { GET } from "@/app/api/dashboard/data/route";
import type { DashboardData } from "@/lib/dashboard-rows";
import { createDeal } from "@/lib/deal";
import { callRoute, dealBuilder, parties, resetDb, signIn, testDeps, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});

const get = (cookie?: string) => Promise.resolve(callRoute(GET as Parameters<typeof callRoute>[0], "GET", "/api/dashboard/data", { cookie }));

describe("GET /api/dashboard/data", () => {
  test("200: only the caller's deals, exact keys, verdicts and decisions attached, no emails or names", async () => {
    const captured = await build.captured(); // buyer + seller
    const mine = await build.draft(); // buyer only
    await createDeal(p.asThird, { text: "I'll pay $20 for the mug once it arrives within a week and matches the photos" }, deps);

    const res = await get(await signIn(p.buyer.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardData;
    expect(Object.keys(body)).toEqual(["generated_at", "deals", "verdicts", "decisions"]);
    expect(body.deals.map((d) => d.code).sort()).toEqual([captured, mine].sort());
    expect(body.generated_at).toBe(deps.clock.now().toISOString());

    const cap = body.deals.find((d) => d.code === captured)!;
    expect(cap).toMatchObject({ role: "buyer", status: "captured", amount_usd: 80, released_usd: 80, held_usd: 0, voided_usd: 0, decision: "capture", fix_attempts_used: 0, seeded: false });
    expect(Object.keys(cap).sort()).toEqual(
      ["amount_usd", "code", "created_at", "deadline_at", "decision", "fix_attempts_used", "held_usd", "item_title", "lowest_confidence", "released_usd", "role", "seeded", "status", "voided_usd"],
    );
    expect(body.verdicts.length).toBeGreaterThan(0);
    expect(body.verdicts.every((v) => v.deal_code === captured && v.submission_no === 1 && v.result === "pass")).toBe(true);
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]).toMatchObject({ deal_code: captured, decision: "capture", amount_usd: 80, is_capture: 1 });
    expect(body.decisions[0].decided_on).toBe(body.decisions[0].decided_at.slice(0, 10));

    const text = JSON.stringify(body);
    for (const leak of ["buyer@test", "seller@test", "seller-pp@test", "Buyer", "Seller", "counterparty", "email"]) expect(text).not.toContain(leak);
  });

  test("the seller sees the shared deal as seller and not the buyer's draft", async () => {
    const captured = await build.captured();
    await build.draft();
    const body = (await (await get(await signIn(p.seller.id))).json()) as DashboardData;
    expect(body.deals.map((d) => [d.code, d.role])).toEqual([[captured, "seller"]]);
  });

  test("signed out -> 401 not_signed_in", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_signed_in");
  });
});
