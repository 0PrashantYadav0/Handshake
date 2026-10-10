// 05 sections 4.7 and 5: one verdict call (17 s attempt inside a 19 s signal, no retry: D4), labels mapped back to
// database ids, the fixed post-processing rules, and every failure mapped to unclear rows. judge() never throws.
// The D8 hash check is not here: lib/deal/verdict.ts runs it before deps.ai.judge (05 section 6.1).
import { AiError, callJson, type MessagesClient } from "./call-json";
import { claude, model } from "./client";
import { JUDGE_SYSTEM, buildJudgeMessages } from "./prompts";
import { VERDICT_SCHEMA, VerdictsZ } from "./schemas";
import { JUDGE_PROMPT_VERSION, type AiFailure, type JudgeInput, type JudgeOutput, type RawResponse, type Verdict } from "./types";

export const JUDGE_EFFORT = "low" as const;
const LISTING_PHOTO_CONDITION = /listing photo/i;

export const unclear = (condition_id: string, reason: string): Verdict => ({ condition_id, result: "unclear", confidence: 0, reason, evidence_used: [] });

export async function judge(
  input: JudgeInput,
  client: MessagesClient = claude(),
  opts: { effort?: "low" | "medium" | "high" } = {}, // only the eval runner sets this (05 section 9)
): Promise<JudgeOutput> {
  try {
    const sent = new Set<string>([
      ...input.reference_photos.map((_, i) => `r${i + 1}`),
      ...input.evidence_photos.map((_, i) => `e${i + 1}`),
      ...(input.tracking_number !== null ? ["tracking"] : []),
      ...(input.note !== null && input.note.trim() !== "" ? ["note"] : []),
    ]);
    const { data, raw } = await callJson(
      client,
      { model: model(), max_tokens: 4_000, effort: opts.effort ?? JUDGE_EFFORT, system: JUDGE_SYSTEM, messages: buildJudgeMessages(input) },
      VERDICT_SCHEMA,
      VerdictsZ,
      { timeout: 17_000, maxRetries: 0, signal: AbortSignal.timeout(19_000) },
    );

    const verdicts = input.conditions.map((c, i): Verdict => {
      const label = `c${i + 1}`;
      const hits = data.verdicts.filter((v) => v.condition_id === label); // ids not on this deal are dropped
      if (hits.length === 0) return unclear(c.id, "The AI returned no verdict for this condition.");
      if (hits.length > 1 || !hits[0]) return unclear(c.id, "The AI returned more than one verdict for this condition.");
      const v = hits[0];
      const evidence_used = [...new Set(v.evidence_used.filter((id) => sent.has(id)))];
      if (v.result === "pass" && evidence_used.length === 0) return unclear(c.id, `${v.reason} (No evidence was cited for this pass.)`);
      if (v.result === "pass" && input.reference_photos.length === 0 && LISTING_PHOTO_CONDITION.test(c.text)) {
        return unclear(c.id, "No listing photos were provided to compare against.");
      }
      return { condition_id: c.id, result: v.result, confidence: v.confidence, reason: v.reason, evidence_used };
    });
    return { verdicts, model: model(), prompt_version: JUDGE_PROMPT_VERSION, raw_response: raw };
  } catch (err) {
    // Every error, not only AiError: a bug in prompt assembly or a bad image buffer must not become a 500
    // that leaves the deal in proof_submitted for tick to hit again.
    if (err instanceof AiError) return allUnclear(input, failureReason(err.failure), err.raw);
    return allUnclear(input, "The AI answer could not be read.", {
      request_id: null, model: model(), stop_reason: null, stop_category: null, usage: null, latency_ms: 0,
      text: null, output: null, error: { kind: "api_error", status: null, type: null, message: String(err) },
    });
  }
}

/** 05 section 5. lib/ai/fake.ts uses the same strings. */
export function failureReason(f: AiFailure): string {
  switch (f.kind) {
    case "timeout": return "The AI did not answer in time.";
    case "api_error": return "The AI service returned an error.";
    case "refusal": return "The AI declined to judge this submission.";
    default: return "The AI answer could not be read.";
  }
}

const allUnclear = (input: JudgeInput, reason: string, raw: RawResponse): JudgeOutput => ({
  verdicts: input.conditions.map((c) => unclear(c.id, reason)),
  model: model(), prompt_version: JUDGE_PROMPT_VERSION, raw_response: raw,
});
