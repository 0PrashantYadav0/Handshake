// Every Extraction bullet of 06 "AI output validation" (ExtractZ + finalizeTerms + the retry), with a fake client.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { MessagesClient } from "@/lib/ai/call-json";
import { extract } from "@/lib/ai/extract";
import { EXTRACT_SCHEMA, ExtractZ } from "@/lib/ai/schemas";
import { EXTRACT_PROMPT_VERSION } from "@/lib/ai/types";
import { DealError } from "@/lib/deal/errors";

const input = { sentence: "I'll pay $80 for the jacket once it arrives", today: new Date("2026-10-09T12:00:00Z") };
const photo = (text: string) => ({ text, evidence_type: "photo" });
const tracking = { text: "Tracking shows delivered", evidence_type: "tracking" };
const base = { item_title: "Jacket", amount_minor: 8000, currency: "USD", deadline_days: 7, conditions: [photo("Item matches the listing photos"), tracking], rejected: [] };

type Reply = Record<string, unknown> | Error;
const message = (output: Record<string, unknown>): Anthropic.Message =>
  ({ id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: JSON.stringify(output) }], usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Message;

/** Each reply is a model output object (a 200 end_turn) or an Error the SDK would throw. */
function fakeClient(...replies: Reply[]) {
  const client: MessagesClient & { calls: number } = {
    calls: 0,
    messages: { create: async () => { client.calls++; const r = replies.shift() ?? new Error("no reply"); if (r instanceof Error) throw r; return message(r); } },
  };
  return client;
}
const run = (over: Record<string, unknown>) => extract(input, fakeClient({ ...base, ...over }));
const rejected = async (p: Promise<unknown>, code: DealError["code"]) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DealError);
    expect((e as DealError).code).toBe(code);
    return e as DealError;
  }
  throw new Error(`expected ${code}`);
};

describe("EXTRACT_SCHEMA (D2, trap 14)", () => {
  it("keeps enum on evidence_type and a type-array nullable on currency", () => {
    expect(EXTRACT_SCHEMA.properties.conditions.items.properties.evidence_type.enum).toEqual(["photo", "tracking"]);
    expect(EXTRACT_SCHEMA.properties.currency.type).toEqual(["string", "null"]);
    expect(EXTRACT_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("ExtractZ", () => {
  it('evidence_type "file" or "link" fails the parse (FR-17)', () => {
    expect(ExtractZ.safeParse({ ...base, conditions: [{ text: "x", evidence_type: "file" }] }).success).toBe(false);
    expect(ExtractZ.safeParse({ ...base, conditions: [{ text: "x", evidence_type: "link" }] }).success).toBe(false);
  });
});

describe("extract() + finalizeTerms()", () => {
  it("returns the model conditions unchanged with model, prompt_version and raw_response (no code condition)", async () => {
    const out = await run({});
    expect(out.conditions).toEqual(base.conditions);
    expect(out).toMatchObject({ amount_minor: 8000, currency: "USD", deadline_days: 7, prompt_version: EXTRACT_PROMPT_VERSION, model: "claude-sonnet-5-5" });
    expect(out.raw_response.output).toEqual(base);
  });
  it('"PHOTO" -> photo and "usd" -> USD', async () => {
    const out = await run({ currency: "usd", conditions: [{ text: "Photo shows a jacket", evidence_type: "PHOTO" }] });
    expect(out.currency).toBe("USD");
    expect(out.conditions[0]?.evidence_type).toBe("photo");
  });
  it("5 conditions -> the first 4", async () => {
    const out = await run({ conditions: ["a", "b", "c", "d", "e"].map((t) => photo(`Photo shows ${t}`)) });
    expect(out.conditions.map((c) => c.text)).toEqual(["Photo shows a", "Photo shows b", "Photo shows c", "Photo shows d"]);
  });
  it("duplicate texts (case-insensitive) and a second tracking condition are dropped; tracking text is normalised", async () => {
    const out = await run({ conditions: [photo("Photo shows a jacket"), photo("photo shows a JACKET"), { text: "Carrier says delivered", evidence_type: "tracking" }, tracking] });
    expect(out.conditions).toEqual([photo("Photo shows a jacket"), tracking]);
  });
  it("0 conditions -> condition_not_checkable 422 carrying the first suggestion", async () => {
    const e = await rejected(run({ conditions: [], rejected: [{ text: "a great haircut", suggestion: "Photo shows the finished haircut from the front" }] }), "condition_not_checkable");
    expect(e.message).toContain('Try: "Photo shows the finished haircut from the front".');
    expect((await rejected(run({ conditions: [] }), "condition_not_checkable")).message).not.toContain("Try:");
  });
  it("EUR -> unsupported_currency 422", async () => {
    expect((await rejected(run({ currency: "EUR", amount_minor: 4500 }), "unsupported_currency")).message).toContain("EUR");
  });
  it("null currency with an amount -> USD; amount null -> currency null", async () => {
    expect((await run({ currency: null, amount_minor: 4000 })).currency).toBe("USD");
    const out = await run({ currency: "USD", amount_minor: null });
    expect(out.amount_minor).toBeNull();
    expect(out.currency).toBeNull();
  });
  it("deadline_days 22 or 0 -> null; amount_minor 1000001 or 1.5 -> null; null accepted", async () => {
    expect((await run({ deadline_days: 22 })).deadline_days).toBeNull();
    expect((await run({ deadline_days: 0 })).deadline_days).toBeNull();
    expect((await run({ deadline_days: null })).deadline_days).toBeNull();
    expect((await run({ amount_minor: 1_000_001 })).amount_minor).toBeNull();
    expect((await run({ amount_minor: 1.5 })).amount_minor).toBeNull();
    expect((await run({ amount_minor: 1_000_000 })).amount_minor).toBe(1_000_000);
  });
  it("item_title of 120 characters -> cut to 80", async () => {
    expect((await run({ item_title: "x".repeat(120) })).item_title).toHaveLength(80);
  });
  it("two AiErrors in a row -> ai_unavailable 503 after exactly two calls", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { ...base, conditions: [{ text: "x", evidence_type: "file" }] };
    for (const [a, b] of [
      [new Anthropic.APIConnectionTimeoutError(), Anthropic.APIError.generate(429, {}, "rate limited", new Headers())],
      [bad, bad],
    ] as Reply[][]) {
      const client = fakeClient(a, b);
      await rejected(extract(input, client), "ai_unavailable");
      expect(client.calls).toBe(2);
    }
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it("one error then success -> success with one retry recorded", async () => {
    const client = fakeClient(new Anthropic.APIConnectionTimeoutError(), base);
    expect((await extract(input, client)).amount_minor).toBe(8000);
    expect(client.calls).toBe(2);
  });
  it("a DealError from finalizeTerms is not retried", async () => {
    const client = fakeClient({ ...base, currency: "EUR" }, base);
    await rejected(extract(input, client), "unsupported_currency");
    expect(client.calls).toBe(1);
  });
});
