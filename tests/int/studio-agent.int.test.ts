// T-38: POST /api/studio/agent through the real handler (04 section 15): signed out -> 401; a mocked Claude client
// round-trips one tool call as a 200 AgLlmResponse; the 31st turn in 10 minutes -> 429 rate_limited (H2).
import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/studio/agent/route";
import type { MessagesClient } from "@/lib/ai/call-json";
import { callRoute, parties, resetDb, signIn, testDeps, type Parties } from "./helpers";

const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
const fake: MessagesClient = {
  messages: {
    create: async (params) => {
      calls.push(params);
      return {
        id: "msg_fake", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "tool_use", stop_details: null,
        content: [{ type: "tool_use", id: "toolu_1", name: "execute_query", input: { status: "voided" } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      } as unknown as Anthropic.Message;
    },
  },
};
vi.mock("@/lib/ai/client", () => ({ claude: () => fake, model: () => "claude-sonnet-5-5" }));

let p: Parties;
beforeEach(async () => {
  await resetDb();
  testDeps();
  p = await parties();
  calls.length = 0;
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
