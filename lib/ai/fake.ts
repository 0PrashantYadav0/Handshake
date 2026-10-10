// Canned AI (06 "Fakes"; 02 section 10). extract failures throw DealError; judge failures never throw (05 section 5).
import { DealError } from "@/lib/deal/errors";
import {
  EXTRACT_PROMPT_VERSION, JUDGE_PROMPT_VERSION,
  type AiDep, type AiFailure, type ExtractInput, type ExtractOutput, type JudgeInput, type JudgeOutput, type RawResponse, type Verdict,
} from "./types";

export type Extract = Omit<ExtractOutput, "model" | "prompt_version" | "raw_response">;
/** Positional patches over the default `pass` verdict; condition_id defaults to the input condition's id. */
export type Verdicts = Partial<Verdict>[];
export type JudgeMode = Verdicts | "timeout" | "refusal" | "invalid" | "missing_c2";

export interface FakeAi extends AiDep {
  calls: Array<{ job: "extract" | "judge"; input: unknown }>;
  extractWith(result: Extract | "timeout" | "refusal" | "invalid"): void;
  judgeWith(result: JudgeMode): void;
}

export const DEFAULT_EXTRACT: Extract = {
  item_title: "Hand-painted denim jacket",
  amount_minor: 8000,
  currency: "USD",
  deadline_days: 7,
  conditions: [
    { text: "Item matches the listing photos", evidence_type: "photo" },
    { text: "Tracking shows delivered", evidence_type: "tracking" },
  ],
  rejected: [],
};

const MODEL = "fake";
const FAILURE: Record<"timeout" | "refusal" | "invalid", { error: AiFailure; reason: string }> = {
  timeout: { error: { kind: "timeout" }, reason: "The AI did not answer in time." },
  refusal: { error: { kind: "refusal", category: null }, reason: "The AI declined to judge this submission." },
  invalid: { error: { kind: "bad_json" }, reason: "The AI answer could not be read." },
};

const raw = (output: unknown, error: AiFailure | null = null): RawResponse => ({
  request_id: "req_fake",
  model: MODEL,
  stop_reason: error?.kind === "refusal" ? "refusal" : "end_turn",
  stop_category: null,
  usage: { input_tokens: 0, output_tokens: 0 },
  latency_ms: 0,
  text: output === null ? null : JSON.stringify(output),
  output,
  error,
});

const unclear = (condition_id: string, reason: string): Verdict => ({ condition_id, result: "unclear", confidence: 0, reason, evidence_used: [] });

export function fakeAi(): FakeAi {
  let extractMode: Extract | "timeout" | "refusal" | "invalid" = DEFAULT_EXTRACT;
  let judgeMode: JudgeMode = [];
  const calls: FakeAi["calls"] = [];

  return {
    calls,
    extractWith: (r) => void (extractMode = r),
    judgeWith: (r) => void (judgeMode = r),

    async extract(input: ExtractInput): Promise<ExtractOutput> {
      calls.push({ job: "extract", input });
      if (typeof extractMode === "string") throw new DealError("ai_unavailable");
      return { ...extractMode, model: MODEL, prompt_version: EXTRACT_PROMPT_VERSION, raw_response: raw(extractMode) };
    },

    async judge(input: JudgeInput): Promise<JudgeOutput> {
      calls.push({ job: "judge", input });
      const out = (verdicts: Verdict[], error: AiFailure | null = null): JudgeOutput => ({
        verdicts, model: MODEL, prompt_version: JUDGE_PROMPT_VERSION, raw_response: raw(error ? null : { verdicts }, error),
      });
      if (judgeMode === "timeout" || judgeMode === "refusal" || judgeMode === "invalid") {
        const f = FAILURE[judgeMode];
        return out(input.conditions.map((c) => unclear(c.id, f.reason)), f.error);
      }
      const patches = judgeMode === "missing_c2" ? [] : judgeMode;
      return out(
        input.conditions.map((c, i) =>
          judgeMode === "missing_c2" && i === 1
            ? unclear(c.id, "The AI returned no verdict for this condition.")
            : { condition_id: c.id, result: "pass", confidence: 0.95, reason: "Matches.", evidence_used: ["e1"], ...patches[i] },
        ),
      );
    },
  };
}
