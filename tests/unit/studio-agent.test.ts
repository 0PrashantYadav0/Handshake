// lib/studio-agent.ts (09 sections 6.2 to 6.4; 04 section 15; T-38): request and response mapping with a fake client,
// one tool call round-trips, failures become status "failed", and the per-user sliding window.
import Anthropic from "@anthropic-ai/sdk";
import type { AgAiConversationItem } from "ag-studio";
import { describe, expect, it } from "vitest";
import type { MessagesClient } from "@/lib/ai/call-json";
import { AGENT_MODEL, AgentBody, allowTurn, GUARD, runAgentTurn, toMessages, toOutput } from "@/lib/studio-agent";

const message = (m: Partial<Anthropic.Message>): Anthropic.Message =>
  ({ id: "msg_1", type: "message", role: "assistant", model: AGENT_MODEL, stop_reason: "end_turn", stop_details: null, content: [], usage: { input_tokens: 10, output_tokens: 5 }, ...m }) as unknown as Anthropic.Message;

function fakeClient(reply: Partial<Anthropic.Message> | Error) {
  const client: MessagesClient & { params?: Anthropic.MessageCreateParamsNonStreaming; opts?: Anthropic.RequestOptions } = {
    messages: { create: async (params, opts) => { client.params = params; client.opts = opts; if (reply instanceof Error) throw reply; return message(reply); } },
  };
  return client;
}

const user = (text: string): AgAiConversationItem => ({ id: "u1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text }] });
const tools = [{ name: "execute_query", description: "Run a query", parameters: { type: "object", properties: { sql: { type: "string" } } } }];

describe("toMessages", () => {
  it("maps messages, function_call and function_call_output, merges adjacent roles, drops reasoning", () => {
    const input: AgAiConversationItem[] = [
      { id: "s", kind: "input", type: "message", role: "system", status: "completed", content: [{ type: "text", text: "ctx" }] },
      user("Show my voided deals"),
      { id: "r", kind: "output", type: "reasoning", summary: [] },
      { id: "a1", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Looking.", annotations: [] }] },
      { id: "c1", kind: "output", type: "function_call", callId: "call:1", name: "execute_query", arguments: '{"sql":"select 1"}' },
      { type: "function_call_output", callId: "call:1", output: '{"rows":[]}', status: "completed" },
      { id: "c2", kind: "output", type: "function_call", callId: "call_2", name: "view_schema", arguments: "" },
      { type: "function_call_output", callId: "call_2", output: "ok", status: "completed" },
      { id: "a2", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "No." }, { type: "text", text: "   ", annotations: [] }] },
    ];
    expect(toMessages(input)).toEqual([
      { role: "user", content: [{ type: "text", text: "ctx" }, { type: "text", text: "Show my voided deals" }] },
      { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "call_1", name: "execute_query", input: { sql: "select 1" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"rows":[]}' }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call_2", name: "view_schema", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_2", content: "ok" }] },
      { role: "assistant", content: [{ type: "text", text: "No." }] },
    ]);
  });
  it("unparseable arguments become {}", () => {
    const [m] = toMessages([{ id: "c", kind: "output", type: "function_call", callId: "x", name: "t", arguments: "{oops" }]);
    expect(m.content).toEqual([{ type: "tool_use", id: "x", name: "t", input: {} }]);
  });
});

describe("toOutput", () => {
  it("text -> message item, tool_use -> function_call with callId and JSON arguments; other blocks dropped", () => {
    const msg = message({
      content: [
        { type: "thinking", thinking: "", signature: "" },
        { type: "text", text: "Here you go.", citations: null },
        { type: "tool_use", id: "toolu_01", name: "add_widget", input: { type: "grid" } },
      ] as unknown as Anthropic.ContentBlock[],
    });
    expect(toOutput(msg)).toEqual([
      { id: "msg_1-1", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Here you go.", annotations: [] }] },
      { id: "toolu_01", kind: "output", type: "function_call", callId: "toolu_01", name: "add_widget", arguments: '{"type":"grid"}', status: "completed" },
    ]);
  });
});

describe("runAgentTurn", () => {
  const body = AgentBody.parse({ instructions: "You are the Lead agent.", input: [user("Show my voided deals")], tools, toolChoice: "auto", model: { id: "x" } });

  it("one tool call round-trips: request carries the Studio tools, Sonnet 5.5 with thinking off; reply is a function_call", async () => {
    const client = fakeClient({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "toolu_9", name: "execute_query", input: { sql: "select * from deals where status = 'voided'" } }] as Anthropic.ContentBlock[] });
    const res = await runAgentTurn(() => client, body);
    expect(client.params).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 2000,
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      tools: [{ name: "execute_query", description: "Run a query", input_schema: tools[0].parameters }],
      messages: [{ role: "user", content: [{ type: "text", text: "Show my voided deals" }] }],
    });
    expect(client.params?.system).toBe(`You are the Lead agent.\n\n${GUARD}`);
    expect(client.params).not.toHaveProperty("temperature");
    expect(client.opts).toMatchObject({ timeout: 30_000, maxRetries: 1 });
    expect(res).toMatchObject({
      id: "msg_1", status: "completed", model: AGENT_MODEL, usage: { inputTokens: 10, outputTokens: 5 },
      output: [{ type: "function_call", callId: "toolu_9", name: "execute_query", arguments: JSON.stringify({ sql: "select * from deals where status = 'voided'" }), status: "completed" }],
    });
    expect(res.error).toBeUndefined();
  });
  it("max_tokens -> incomplete with the partial text; refusal -> failed", async () => {
    const cut = await runAgentTurn(() => fakeClient({ stop_reason: "max_tokens", content: [{ type: "text", text: "partial", citations: null }] }), body);
    expect(cut).toMatchObject({ status: "incomplete", incompleteDetails: { reason: "max_output_tokens" }, output: [{ type: "message" }] });
    const refused = await runAgentTurn(() => fakeClient({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } as never }), body);
    expect(refused).toMatchObject({ status: "failed", output: [], error: { code: "refusal" } });
  });
  it("an SDK error or a client that cannot be built is a failed response, never a throw", async () => {
    const apiErr = new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers());
    expect(await runAgentTurn(() => fakeClient(apiErr), body)).toMatchObject({ status: "failed", error: { code: "api_429", message: expect.stringContaining("slow down") } });
    const noKey = await runAgentTurn(() => { throw new Error("The ANTHROPIC_API_KEY environment variable is missing or empty"); }, body);
    expect(noKey).toMatchObject({ status: "failed", error: { code: "unavailable", message: expect.stringContaining("ANTHROPIC_API_KEY") } });
  });
});

describe("AgentBody", () => {
  it("drops toolChoice/responseFormat/model and rejects oversize", () => {
    expect(Object.keys(AgentBody.parse({ input: [], tools: [], toolChoice: "auto", responseFormat: { type: "text" } }))).toEqual(["input", "tools"]);
    expect(AgentBody.safeParse({ input: Array.from({ length: 81 }, () => ({ type: "message" })), tools: [] }).success).toBe(false);
    expect(AgentBody.safeParse({ input: [], tools: [{ name: "", parameters: {} }] }).success).toBe(false);
  });
});

describe("allowTurn", () => {
  it("30 turns per 10 minutes per user, sliding", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(allowTurn("u", t0 + i)).toBe(true);
    expect(allowTurn("u", t0 + 30)).toBe(false);
    expect(allowTurn("other", t0 + 30)).toBe(true);
    expect(allowTurn("u", t0 + 10 * 60_000)).toBe(true); // the first turn has left the window
    expect(allowTurn("u", t0 + 10 * 60_000)).toBe(false);
  });
});
