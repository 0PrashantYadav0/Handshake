// docs/agents.md: agent keys, the mandate, the MCP surface and the negotiation guard. The money path stays behind a person and the rule.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { negotiate, runToGate, SCENARIOS, type DeskEvent, type ScenarioId } from "@/lib/agents/desk";
import { agentFromToken, issueAgentKey, revokeAgentKey } from "@/lib/agents/keys";
import { handleRpc } from "@/lib/agents/mcp";
import { callTool, TOOLS, type ToolContext } from "@/lib/agents/tools";
import { composeCode, kit } from "@/lib/agents/samples";
import { prisma } from "@/lib/db";
import { getDeal, handle } from "@/lib/deal";
import type { DealView } from "@/lib/deal/types";
import { assertEventsInC6, expectError, parties, resetDb, testDeps, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let buyer: ToolContext;
let seller: ToolContext;
const SENTENCE = "I'll pay $80 for the blue ceramic mug if it arrives within 5 days, matches the listing photos and tracking shows delivered";
const prevDemo = process.env.DEMO_LOGIN;
beforeAll(() => void (process.env.DEMO_LOGIN = "true"));
afterAll(() => void (process.env.DEMO_LOGIN = prevDemo));

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  const b = await issueAgentKey(p.buyer.id, { label: "Buyer bot", max_amount_minor: 10_000 }, prisma);
  const s = await issueAgentKey(p.seller.id, { label: "Seller bot", max_amount_minor: 10_000 }, prisma);
  buyer = { key: b.key, deps, baseUrl: "https://x.test" };
  seller = { key: s.key, deps, baseUrl: "https://x.test" };
});
afterEach(assertEventsInC6);

type Brief = { code: string; status: string; signed: { buyer: boolean; seller: boolean }; latest_decision: string | null; verdicts: unknown[]; next_step: string };
const run = (name: string, args: unknown, c: ToolContext) => callTool(name, args, c) as Promise<Brief>;

async function toAgreed(): Promise<string> {
  const { code } = await run("propose_deal", { sentence: SENTENCE }, buyer);
  await run("add_listing_photos", { code, use_sample: true }, buyer);
  await run("join_deal", { code }, seller);
  await run("sign_contract", { code }, seller);
  await run("sign_contract", { code }, buyer);
  return code;
}

describe("agent keys", () => {
  test("the token works until revoked, is stored only as a hash, and the private key is sealed", async () => {
    const { token, key } = await issueAgentKey(p.buyer.id, { label: "Mine", max_amount_minor: 2500 }, prisma);
    expect(token).toMatch(/^hsk_/);
    const row = await prisma.agentKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(row.token_hash).not.toContain(token);
    expect(row.signing_jwk).toMatch(/^enc1\./);
    expect((await agentFromToken(token, prisma, deps.clock.now()))?.id).toBe(key.id);
    await revokeAgentKey(p.buyer.id, key.id, prisma, deps.clock.now());
    expect(await agentFromToken(token, prisma, deps.clock.now())).toBeNull();
    expect(await agentFromToken("hsk_nope", prisma, deps.clock.now())).toBeNull();
  });

  test("someone else cannot revoke a key", async () => {
    await expectError(revokeAgentKey(p.third.id, buyer.key.id, prisma, deps.clock.now()), "invalid_input");
    expect((await prisma.agentKey.findUniqueOrThrow({ where: { id: buyer.key.id } })).revoked_at).toBeNull();
  });
});

describe("the mandate", () => {
  test("a proposal over the ceiling is refused and its draft cancelled", async () => {
    const small = await issueAgentKey(p.buyer.id, { label: "Small", max_amount_minor: 2000 }, prisma);
    await expectError(run("propose_deal", { sentence: SENTENCE }, { ...buyer, key: small.key }), "mandate_exceeded");
    expect(await prisma.deal.findFirstOrThrow({ select: { status: true } })).toEqual({ status: "voided" });
  });

  test("a buyer agent cannot sign terms over its ceiling, even if the deal started under it", async () => {
    const { code } = await run("propose_deal", { sentence: SENTENCE }, buyer);
    await run("join_deal", { code }, seller);
    const small = await issueAgentKey(p.buyer.id, { label: "Small", max_amount_minor: 2000 }, prisma);
    await expectError(run("sign_contract", { code }, { ...buyer, key: small.key }), "mandate_exceeded");
  });
});

describe("agents run a deal, and only a person approves money", () => {
  test("both agents sign; their signatures pass the same contract gate as a browser's", async () => {
    const code = await toAgreed();
    const d = (await getDeal(code, p.asBuyer, deps)) as DealView;
    expect(d.status).toBe("terms_agreed");
    expect(d.contract!.signatures).toHaveLength(2);
    // start_payment runs verifyContract: it would throw contract_invalid on a bad agent signature.
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    expect(deps.paypal.calls.some((c) => c.op === "createAuthorizeOrder")).toBe(true);
  });

  test("no tool approves a hold or decides a review, and none moves money before the hold", async () => {
    const names = TOOLS.map((t) => t.name);
    for (const banned of ["review", "approve", "confirm_approval", "start_payment", "capture", "payout"]) expect(names.some((n) => n.includes(banned))).toBe(false);
    const code = await toAgreed();
    await expectError(run("submit_proof", { code, use_sample: "good" }, seller), "invalid_state");
    expect(deps.paypal.calls.filter((c) => /capture|payout/i.test(c.op))).toEqual([]);
    const b = await run("get_deal", { code }, buyer);
    expect(b.next_step).toContain("A person must");
  });

  test("after the person's approval the seller agent's proof runs the rule: pass captures", async () => {
    const code = await toAgreed();
    const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps);
    const r = await run("submit_proof", { code, use_sample: "good" }, seller);
    expect(r.latest_decision).toBe("capture");
    expect(r.status).toBe("captured");
    expect(r.verdicts).toHaveLength(3);
  }, 30_000);

  test("wrong item: request_fix, then void, and the seller's agent gets nothing", async () => {
    const code = await toAgreed();
    const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps);
    deps.ai.judgeWith([{ result: "fail", confidence: 0.97, reason: "A different item." }]);
    expect((await run("submit_proof", { code, use_sample: "good" }, seller)).latest_decision).toBe("request_fix");
    const second = await run("submit_proof", { code, use_sample: "good" }, seller);
    expect(second.latest_decision).toBe("void");
    expect(second.status).toBe("voided");
    expect(deps.paypal.calls.filter((c) => /capture/i.test(c.op))).toEqual([]);
  }, 30_000);

  test("an agent is held to its user's access: a third party's agent sees nothing", async () => {
    const code = await toAgreed();
    const t = await issueAgentKey(p.third.id, { label: "Nosy", max_amount_minor: 1000 }, prisma);
    await expectError(run("get_deal", { code }, { ...buyer, key: t.key }), "not_a_party");
  });
});

describe("the MCP surface", () => {
  test("initialize, tools/list with JSON schemas, tools/call, errors and notifications", async () => {
    const init = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, buyer)) as { result: { protocolVersion: string; capabilities: unknown } };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities).toEqual({ tools: {} });
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, buyer)).toBeNull();

    const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, buyer)) as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain("propose_deal");
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe("object");

    const call = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_mandate", arguments: {} } }, buyer)) as { result: { isError: boolean; content: { text: string }[] } };
    expect(call.result.isError).toBe(false);
    expect(JSON.parse(call.result.content[0]!.text).only_a_person_can).toContain("approve a hold at PayPal");

    const refused = (await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_deal", arguments: { code: "nope" } } }, buyer)) as { result: { isError: boolean } };
    expect(refused.result.isError).toBe(true);
    const unknown = (await handleRpc({ jsonrpc: "2.0", id: 5, method: "resources/list" }, buyer)) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32601);
  });
});

describe("negotiation", () => {
  const run2 = async (id: ScenarioId = "honest") => {
    const seen: DeskEvent[] = [];
    const price = await negotiate(id, deps, (e) => seen.push(e));
    return { price, seen };
  };

  test("an accept inside the limit closes at the standing offer", async () => {
    let turn = 0;
    deps.ai.negotiateWith((i) => ({ say: "ok", offer_minor: i.role === "buyer" ? 1800 : 1800, accept: turn++ === 1 }));
    expect((await run2()).price).toBe(1800);
  });

  test("code refuses an accept over the buyer's budget and caps an over-limit offer", async () => {
    deps.ai.negotiateWith((i) => (i.role === "buyer" ? { say: "Fine, I'll overpay", offer_minor: 9900, accept: true } : { say: "Sold", offer_minor: i.history.at(-1)!.offer_minor, accept: true }));
    const { price, seen } = await run2();
    expect(seen.filter((e) => e.t === "guard").length).toBeGreaterThan(0);
    expect(price).toBe(SCENARIOS.honest.budget_minor);
  });

  test.each([false, true])("the injected opening reaches the buyer's model as an offer, and the real purchase stops at the mandate (a fooled model accepting: %s)", async (accept) => {
    const seen: string[] = [];
    deps.ai.negotiateWith((i) => {
      seen.push(i.history[0]!.say);
      return i.role === "buyer" ? { say: "No.", offer_minor: 1500, accept } : { say: "No.", offer_minor: 9500, accept };
    });
    const out: DeskEvent[] = [];
    await runToGate("hijack", p.buyer.id, deps, "https://x.test", (e) => out.push(e));
    expect(seen[0]).toContain("SYSTEM OVERRIDE");
    expect(out.some((e) => e.t === "guard" && e.text.includes("ceiling"))).toBe(true);
    expect(out.some((e) => e.t === "gate")).toBe(false);
    expect(deps.paypal.calls).toEqual([]);
  });

  test("a seller can't be talked below its floor", async () => {
    deps.ai.negotiateWith((i) => (i.role === "buyer" ? { say: "A dollar", offer_minor: 100, accept: false } : { say: "No", offer_minor: 100, accept: true }));
    const { price, seen } = await run2();
    expect(price).toBeGreaterThanOrEqual(SCENARIOS.honest.floor_minor);
    expect(seen.some((e) => e.t === "guard" && e.agent === "seller")).toBe(true);
  });

  // [buyer's last offer, seller's last offer, close]: the midpoint in whole dollars, then clamped to the budget.
  test.each([[1700, 1850, 1800], [2000, 2400, 2000]])("a model that never accepts still closes inside both limits: %i and %i close at %i", async (bid, ask, close) => {
    deps.ai.negotiateWith((i) => ({ say: "No", offer_minor: i.role === "buyer" ? bid : ask, accept: false }));
    const { price, seen } = await run2();
    expect(price).toBe(close);
    expect(seen.at(-1)).toMatchObject({ t: "guard", agent: "buyer", text: `Out of turns. $${close / 100}.00 is inside both limits, so code closes the deal there.` });
  });

  test.each(["honest", "cheat"] as const)("%s: whatever the offers, a model that never accepts closes at or inside both limits", async (id) => {
    const { budget_minor, floor_minor } = SCENARIOS[id];
    for (const [bid, ask] of [[100, 999_900], [budget_minor, floor_minor], [floor_minor, budget_minor]]) {
      deps.ai.negotiateWith((i) => ({ say: "No", offer_minor: i.role === "buyer" ? bid! : ask!, accept: false }));
      const { price, seen } = await run2(id);
      expect(price).toBeGreaterThanOrEqual(floor_minor);
      expect(price).toBeLessThanOrEqual(budget_minor);
      expect(seen.at(-1)).toMatchObject({ t: "guard", agent: "buyer", text: expect.stringContaining("Out of turns.") });
    }
  });

  test("the buyer's extra turn answers the seller's last offer, and code doesn't step in", async () => {
    let turn = 0;
    deps.ai.negotiateWith((i) => ({ say: "Deal", offer_minor: i.role === "buyer" ? 1700 : 1900, accept: ++turn === 9 })); // 4 rounds of 2, then the buyer
    const { price, seen } = await run2();
    expect(turn).toBe(9);
    expect(price).toBe(1900); // the seller's offer, not the 1800 midpoint
    expect(seen.some((e) => e.t === "guard")).toBe(false);
  });

  test.each([false, true])("limits that don't overlap end with no deal (a fooled model accepting: %s)", async (accept) => {
    deps.ai.negotiateWith((i) => ({ say: "OK", offer_minor: i.role === "buyer" ? 9500 : 9500, accept }));
    const { price, seen } = await run2("hijack");
    expect(price).toBeNull();
    expect(seen.some((e) => e.t === "guard" && e.text.startsWith("Mandate refused"))).toBe(accept);
  });
});

test("the composed code photo is a JPEG on the real kit", async () => {
  const mug = kit().presets[0]!;
  const out = await composeCode(mug.code_photo.base, "HS-7KQ2", mug.code_photo.box);
  expect([out[0], out[1], out[2]]).toEqual([0xff, 0xd8, 0xff]);
}, 30_000);
