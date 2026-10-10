// callJson() failure mapping (05 section 2.2, section 5) with a fake client returning canned Message objects.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiError, callJson, type CallParams, type MessagesClient } from "@/lib/ai/call-json";

const Z = z.object({ ok: z.boolean() });
const params: CallParams = { model: "m", max_tokens: 10, system: "s", messages: [{ role: "user", content: "u" }], effort: "low" };
const opts = { timeout: 1000, maxRetries: 0 };

const message = (over: Record<string, unknown>): Anthropic.Message =>
  ({
    id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", stop_sequence: null, stop_details: null,
    container: null, content: [{ type: "text", text: '{"ok":true}', citations: null }],
    usage: { input_tokens: 3, output_tokens: 4 }, _request_id: "req_1", ...over,
  }) as unknown as Anthropic.Message;

const client = (reply: Anthropic.Message | Error): MessagesClient => ({
  messages: { create: async () => { if (reply instanceof Error) throw reply; return reply; } },
});

const failure = async (reply: Anthropic.Message | Error) => {
  try {
    await callJson(client(reply), params, { type: "object" }, Z, opts);
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    return e as AiError;
  }
  throw new Error("expected AiError");
};

describe("callJson()", () => {
  it("end_turn with JSON text -> data and a filled RawResponse", async () => {
    const { data, raw } = await callJson(client(message({})), params, { type: "object" }, Z, opts);
    expect(data).toEqual({ ok: true });
    expect(raw).toMatchObject({ request_id: "req_1", model: "m", stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 4 }, text: '{"ok":true}', output: { ok: true }, error: null });
  });
  it("sends output_config with effort and the json_schema format, no tools or temperature", async () => {
    let sent: Anthropic.MessageCreateParamsNonStreaming | undefined;
    const spy: MessagesClient = { messages: { create: async (p) => { sent = p; return message({}); } } };
    await callJson(spy, params, { type: "object" }, Z, opts);
    expect(sent?.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: { type: "object" } } });
    expect(sent).not.toHaveProperty("effort");
    expect(sent).not.toHaveProperty("tools");
    expect(sent).not.toHaveProperty("temperature");
  });
  it("skips a leading thinking block and finds the text block by type", async () => {
    const { data } = await callJson(client(message({ content: [{ type: "thinking", thinking: "", signature: "" }, { type: "text", text: '{"ok":false}' }] })), params, {}, Z, opts);
    expect(data).toEqual({ ok: false });
  });
  it("refusal -> refusal with stop_category", async () => {
    const e = await failure(message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }));
    expect(e.failure).toEqual({ kind: "refusal", category: "cyber" });
    expect(e.raw.stop_category).toBe("cyber");
  });
  it("max_tokens -> stop", async () => {
    expect((await failure(message({ stop_reason: "max_tokens" }))).failure).toEqual({ kind: "stop", stop_reason: "max_tokens" });
  });
  it("no text block -> no_text", async () => {
    expect((await failure(message({ content: [] }))).failure).toEqual({ kind: "no_text" });
  });
  it("bad JSON -> bad_json, raw.text kept", async () => {
    const e = await failure(message({ content: [{ type: "text", text: "{oops" }] }));
    expect(e.failure).toEqual({ kind: "bad_json" });
    expect(e.raw.text).toBe("{oops");
  });
  it("Zod mismatch -> schema_mismatch with issues, raw.output kept", async () => {
    const e = await failure(message({ content: [{ type: "text", text: '{"ok":"yes"}' }] }));
    expect(e.failure.kind).toBe("schema_mismatch");
    expect(e.raw.output).toEqual({ ok: "yes" });
  });
  it("APIConnectionTimeoutError and APIUserAbortError -> timeout", async () => {
    expect((await failure(new Anthropic.APIConnectionTimeoutError())).failure).toEqual({ kind: "timeout" });
    expect((await failure(new Anthropic.APIUserAbortError())).failure).toEqual({ kind: "timeout" });
  });
  it("APIError 429 -> api_error with status and type", async () => {
    const err = Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers());
    const e = await failure(err);
    expect(e.failure).toMatchObject({ kind: "api_error", status: 429, type: "rate_limit_error" });
    expect(e.raw.error).toEqual(e.failure);
  });
  it("an unknown throw -> api_error with null status", async () => {
    expect((await failure(new Error("boom"))).failure).toMatchObject({ kind: "api_error", status: null, type: null });
  });
});
