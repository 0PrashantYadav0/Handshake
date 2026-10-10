// T-29: the eval runner on the synthetic fixture case with a fake client (no API, no eval/cases). 05 section 9.3 maths and the results-file shape.
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { MessagesClient } from "@/lib/ai/call-json";
import { DealError } from "@/lib/deal/errors";
import { counting, evaluateExtract, listCases, loadCase, resultsName, runCase, runCases, summarise, type CaseRow, type Sentence } from "../../eval/run";

const ROOT = join(__dirname, "../fixtures/eval");
const message = (verdicts: unknown[], over: Partial<Anthropic.Message> = {}): Anthropic.Message =>
  ({ id: "msg_1", type: "message", role: "assistant", model: "m", stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 100, output_tokens: 10 },
    content: [{ type: "text", text: JSON.stringify({ verdicts }), citations: null }], ...over }) as unknown as Anthropic.Message;
const v = (condition_id: string, result = "pass", evidence_used = ["e1"]) => ({ condition_id, result, confidence: 0.95, reason: "r", evidence_used });
const allPass = [v("c1"), v("c2", "pass", ["tracking"]), v("c3")];

function fake(reply: Anthropic.Message | Error) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = { messages: { create: async (params) => { calls.push(params); if (reply instanceof Error) throw reply; return reply; } } };
  return { client, calls };
}

describe("loadCase (05 section 9.2)", () => {
  const c = loadCase(join(ROOT, "fixture-01-synthetic"));
  it("assembles the JudgeInput as lib/deal would", () => {
    expect(listCases(ROOT)).toEqual(["fixture-01-synthetic"]);
    expect(c.name).toBe("fixture-01-synthetic");
    expect(c.input.reference_photos.map((p) => p.id)).toEqual(["01.png", "02.png"]);
    expect(c.input.evidence_photos.map((p) => [p.id, p.mime, p.sha256.length])).toEqual([["01.png", "image/png", 64], ["02.png", "image/png", 64]]);
    expect(c.input).toMatchObject({ code: "HS-2A3B", tracking_number: "TRK-DEMO-0000", carrier_status: "delivered", note: "Shipped Monday", submission_no: 1 });
    expect(c.input.conditions.at(-1)?.text).toBe("Photo shows the deal code HS-2A3B written by hand");
  });
});

describe("runCases end to end with a fake client", () => {
  const c = loadCase(join(ROOT, "fixture-01-synthetic"));

  it("judges, decides and matches; the effort flag reaches the request", async () => {
    const { client, calls } = fake(message(allPass));
    const lines: string[] = [];
    const rows = await runCases([c], { client, effort: "medium", repeats: 2, concurrency: 2, log: (l) => lines.push(l) });
    expect(rows.map((r) => [r.decision, r.match, r.wrong_capture, r.model, r.skipped])).toEqual([["capture", true, false, "claude-sonnet-5-5", null], ["capture", true, false, "claude-sonnet-5-5", null]]);
    expect(rows[0]!.verdicts).toEqual([
      { condition_id: "c1", result: "pass", confidence: 0.95, expected: "pass" }, { condition_id: "c2", result: "pass", confidence: 0.95, expected: "pass" }, { condition_id: "c3", result: "pass", confidence: 0.95, expected: "pass" },
    ]);
    expect(rows[0]!.usage).toEqual({ input_tokens: 100, output_tokens: 10 });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.output_config).toMatchObject({ effort: "medium" });
    expect(lines[0]).toMatch(/^fixture-01-synthetic\s+capture\s+capture\s+ok/);
  });

  it("a byte-identical listing photo takes the D8 path: no model call, model none, hash_match", async () => {
    const { client, calls } = fake(message(allPass));
    const reused = { ...c, expected: { ...c.expected, decision: "request_fix" as const, hash_match: true }, input: { ...c.input, evidence_photos: [c.input.reference_photos[0]!] } };
    const row = await runCase(reused, { client });
    expect(calls).toHaveLength(0);
    expect(row).toMatchObject({ decision: "request_fix", match: true, model: "none", prompt_version: "guardrail-v1", skipped: "hash_match", guardrail_miss: false, latency_ms: 0, usage: null });
    // expected.hash_match true but the model was called: flagged, and the decision metric is untouched
    const missed = await runCase({ ...c, expected: { ...c.expected, hash_match: true } }, { client });
    expect([missed.guardrail_miss, missed.match]).toEqual([true, true]);
  });

  it("a failed call becomes unclear rows, buyer_review, and the failure kind is recorded", async () => {
    const { client } = fake(new Error("boom"));
    const row = await runCase(c, { client });
    expect(row).toMatchObject({ decision: "buyer_review", reason: "unclear", match: false, wrong_capture: false, error: "api_error" });
  });
});

describe("summarise (05 section 9.3 metrics)", () => {
  const row = (name: string, expected: CaseRow["expected"], decision: CaseRow["decision"], latency_ms = 1000, error: string | null = null): CaseRow =>
    ({ name, group: name.split("-")[0]!, expected, decision, reason: "all_pass", match: decision === expected, wrong_capture: decision === "capture" && expected !== "capture",
      model: "m", prompt_version: "judge-v1", skipped: null, guardrail_miss: false, verdicts: [], latency_ms, usage: { input_tokens: 1000, output_tokens: 100 }, error, stop_category: null });
  const rows = [
    row("correct-01", "capture", "capture", 500), row("correct-01", "capture", "buyer_review", 1500), // flip
    row("wrong-01", "request_fix", "request_fix", 2000), row("wrong-02", "request_fix", "capture", 9000), // the wrong capture
    row("blurry-01", "buyer_review", "buyer_review", 3000, "timeout"),
  ];
  const s = summarise(rows, "claude-sonnet-5-5");
  it("decision-match and wrong-capture rates, groups, flips, failures, latency, cost", () => {
    expect([s.runs, s.matched, s.decision_match_rate]).toEqual([5, 3, 0.6]);
    expect([s.not_capture_runs, s.wrong_captures, s.wrong_capture_rate]).toEqual([3, 1, 1 / 3]);
    expect(s.by_group).toEqual({ correct: { matched: 1, runs: 2 }, wrong: { matched: 1, runs: 2 }, blurry: { matched: 1, runs: 1 } });
    expect(s.flips).toBe(1);
    expect(s.failures).toEqual({ timeout: 1 });
    expect(s.latency_ms).toEqual({ p50: 2000, p95: 9000, max: 9000 });
    expect(s.tokens).toEqual({ mean_in: 1000, mean_out: 100, est_cost_usd: 0.015 }); // 5 x (1000 x $2 + 100 x $10) / 1e6
  });
  it("is zero-safe on no rows and unpriced models", () => {
    expect(summarise([], "other")).toMatchObject({ runs: 0, decision_match_rate: 0, wrong_capture_rate: 0, latency_ms: { p50: 0, p95: 0, max: 0 }, tokens: { est_cost_usd: null } });
  });
  it("names the results file <YYYYMMDD-HHMM>-<model>-<effort>.json", () => {
    expect(resultsName("claude-sonnet-5-5", "low", new Date("2026-10-10T14:05:00Z"))).toBe("20261010-1405-claude-sonnet-5-5-low.json");
  });
});

describe("evaluateExtract (05 section 9.2)", () => {
  const out = (over: Record<string, unknown>) => ({
    item_title: "x", amount_minor: 8000, currency: "USD" as const, deadline_days: null, conditions: [{ text: "a", evidence_type: "photo" as const }, { text: "b", evidence_type: "tracking" as const }],
    rejected: [], model: "m", prompt_version: "extract-v1" as const, raw_response: { request_id: null, model: "m", stop_reason: "end_turn", stop_category: null, usage: null, latency_ms: 5, text: null, output: null, error: null }, ...over,
  });
  const jacket: Sentence = { name: "jacket", today: "2026-10-09", sentence: "s", expected: { amount_minor: 8000, currency: "USD", deadline_days: null, photo: true, tracking: true, rejected_min: 0 } };
  const euro: Sentence = { name: "euro", today: "2026-10-09", sentence: "s", expected: { error: "unsupported_currency" } };
  it("fields, at-least-one-of-type and rejected_min; error cases match on the DealError code", () => {
    expect(evaluateExtract(jacket, out({})).match).toBe(true);
    expect(evaluateExtract(jacket, out({ deadline_days: 7 })).match).toBe(false);
    expect(evaluateExtract({ ...jacket, expected: { ...jacket.expected, rejected_min: 1 } }, out({})).match).toBe(false);
    expect(evaluateExtract(euro, new DealError("unsupported_currency"))).toMatchObject({ match: true, error: "unsupported_currency" });
    expect(evaluateExtract(jacket, new DealError("ai_unavailable")).match).toBe(false);
  });
});

describe("counting client wrapper (05 section 10.3)", () => {
  it("counts calls, 400s and refusals", async () => {
    const err = Object.assign(new Error("bad schema"), { status: 400 });
    const bad = counting(fake(err).client);
    await expect(bad.client.messages.create({} as Anthropic.MessageCreateParamsNonStreaming)).rejects.toThrow("bad schema");
    const refused = counting(fake(message([], { stop_reason: "refusal" })).client);
    await refused.client.messages.create({} as Anthropic.MessageCreateParamsNonStreaming);
    expect([bad.counters, refused.counters]).toEqual([{ calls: 1, bad_requests: 1, refusals: 0 }, { calls: 1, bad_requests: 0, refusals: 1 }]);
  });
});
