// T-38: POST /api/studio/agent through the real handler (04 section 15): signed out -> 401; a mocked Claude client
// round-trips one tool call as a 200 AgLlmResponse; the 31st turn in 10 minutes -> 429 rate_limited (H2).
// T-39: explain_verdict runs on the server with the caller's actor (09 section 6.5): own deal -> the stored verdicts;
// another user's deal or an unknown code -> an is_error tool_result and still a 200, never a 500.
import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/studio/agent/route";
import type { MessagesClient } from "@/lib/ai/call-json";
import { explainVerdict } from "@/lib/studio-tools";
import { callRoute, dealBuilder, expectError, parties, resetDb, signIn, testDeps, type Parties, type TestDeps } from "./helpers";

const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
let script: Anthropic.ContentBlock[][] = [];
const fake: MessagesClient = {
  messages: {
    create: async (params) => {
      calls.push(params);
      const content = script.shift() ?? [{ type: "tool_use", id: "toolu_1", name: "execute_query", input: { status: "voided" } }];
      return {
        id: "msg_fake", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: content[0].type === "tool_use" ? "tool_use" : "end_turn", stop_details: null,
        content, usage: { input_tokens: 1, output_tokens: 1 },
      } as unknown as Anthropic.Message;
    },
  },
};
vi.mock("@/lib/ai/client", () => ({ claude: () => fake, model: () => "claude-sonnet-5-5" }));

let p: Parties;
let deps: TestDeps;
beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  calls.length = 0;
  script = [];
});

const body = {
  instructions: "Lead agent.",
  input: [{ id: "u1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Show my voided deals" }] }],
  tools: [{ name: "execute_query", description: "Run a query", parameters: { type: "object", properties: { status: { type: "string" } } } }],
  toolChoice: "auto",
};
const post = (cookie?: string, b: unknown = body) => Promise.resolve(callRoute(POST as Parameters<typeof callRoute>[0], "POST", "/api/studio/agent", { cookie, body: b }));

describe("POST /api/studio/agent", () => {
  test("signed out -> 401 not_signed_in, no model call", async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_signed_in");
    expect(calls).toHaveLength(0);
  });

  test("one tool call round-trips: 200 with a function_call output item built from the model's tool_use", async () => {
    const res = await post(await signIn(p.buyer.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: "msg_fake", status: "completed",
      output: [{ type: "function_call", callId: "toolu_1", name: "execute_query", arguments: '{"status":"voided"}' }],
    });
    expect(calls[0]).toMatchObject({ model: "claude-sonnet-5-5", thinking: { type: "between_tools" }, tools: [{ name: "execute_query" }] });
    expect(calls[0].system).toContain("Lead agent.");
  });

  test("malformed body -> 400 invalid_input", async () => {
    const res = await post(await signIn(p.buyer.id), { input: "nope" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_input");
  });

  test("the 31st turn within 10 minutes -> 429 rate_limited; another user is unaffected", async () => {
    const cookie = await signIn(p.seller.id);
    for (let i = 0; i < 30; i++) expect((await post(cookie)).status).toBe(200);
    const res = await post(cookie);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "rate_limited", message: "Too many questions in a row. Wait a few minutes and ask again." } });
    expect(calls).toHaveLength(30);
    expect((await post(await signIn(p.buyer.id))).status).toBe(200);
  });
});

describe("explain_verdict (T-39)", () => {
  const ask = (code: string): Anthropic.ContentBlock[] => [{ type: "tool_use", id: "toolu_ev", name: "explain_verdict", input: { code } } as Anthropic.ContentBlock];
  const done: Anthropic.ContentBlock[] = [{ type: "text", text: "Explained.", citations: null } as Anthropic.ContentBlock];

  test("own deal: the stored verdicts, the decision and the money trail, delimited as data", async () => {
    const code = await dealBuilder(deps, p).inReview();
    const out = await explainVerdict({ code: code.toLowerCase() }, p.asBuyer, deps);
    expect(out.startsWith('<deal_record untrusted="true">')).toBe(true);
    const record = JSON.parse(out.slice(out.indexOf("\n") + 1, out.lastIndexOf("\n")));
    expect(record).toMatchObject({ code, status: "in_review", my_role: "buyer", amount_usd: 80, fix_attempts_used: 0, decisions: [{ submission_no: 1, decision: "buyer_review", reason: "unclear" }] });
    expect(record.conditions[0].verdicts).toEqual([{ submission_no: 1, result: "unclear", confidence: 0.4, reason: "Blurry." }]);
    expect(record.conditions.length).toBeGreaterThan(1);
    expect(record.money.payment.status).toBeDefined();
    expect(record.money.events.map((e: { cause: string }) => e.cause)).toContain("decision:buyer_review");
  });

  test("another user's deal -> not_a_party; unknown code -> deal_not_found; bad args -> invalid_input", async () => {
    const code = await dealBuilder(deps, p).inReview();
    await expectError(explainVerdict({ code }, p.asThird, deps), "not_a_party");
    await expectError(explainVerdict({ code: "HS-NOPE" }, p.asBuyer, deps), "deal_not_found");
    await expectError(explainVerdict({}, p.asBuyer, deps), "invalid_input");
  });

  test("through the route: the tool runs as the signed-in user; the other party's error is an is_error tool_result, still 200", async () => {
    const code = await dealBuilder(deps, p).captured();
    script = [ask(code), done];
    const res = await post(await signIn(p.seller.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "completed", output: [{ type: "message", content: [{ text: "Explained." }] }] });
    expect(calls).toHaveLength(2);
    const fedBack = calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(fedBack[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_ev" });
    expect(fedBack[0].is_error).toBeUndefined();
    expect(String(fedBack[0].content)).toContain('"decision":"capture"');

    calls.length = 0;
    script = [ask(code), done];
    const other = await post(await signIn(p.third.id));
    expect(other.status).toBe(200);
    expect(((calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0])).toEqual({ type: "tool_result", tool_use_id: "toolu_ev", is_error: true, content: "You are not a party to this deal." });
  });
});
