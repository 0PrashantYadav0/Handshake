// AI types reproduced from 05-ai-spec.md sections 1, 2.2, 3.1, 3.6, 4.1, 4.7 and 6.1 (via 02 section 3.4).
export const EXTRACT_PROMPT_VERSION = "extract-v1" as const;
export const JUDGE_PROMPT_VERSION = "judge-v1" as const;
export const GUARDRAIL_VERSION = "guardrail-v1" as const;

export type AiFailure =
  | { kind: "timeout" }
  | { kind: "api_error"; status: number | null; type: string | null; message: string }
  | { kind: "refusal"; category: string | null }
  | { kind: "stop"; stop_reason: string } // "max_tokens" or any other non-end_turn stop
  | { kind: "no_text" }
  | { kind: "bad_json" }
  | { kind: "schema_mismatch"; issues: string };

/** Stored verbatim in verdicts.raw_response (05 section 8). */
export interface RawResponse {
  request_id: string | null;
  model: string; // the model id we asked for
  stop_reason: string | null;
  stop_category: string | null; // msg.stop_details?.category on refusal
  usage: { input_tokens: number; output_tokens: number } | null;
  latency_ms: number;
  text: string | null; // the raw text block, before JSON.parse
  output: unknown; // JSON.parse(text) when it parsed, else null
  error: AiFailure | null;
}

/** One turn of an agent negotiation (docs/agents.md). limit_minor is private to the agent whose turn it is. */
export interface NegotiateInput {
  role: "buyer" | "seller";
  item: string;
  limit_minor: number;
  list_minor: number;
  history: { role: "buyer" | "seller"; say: string; offer_minor: number }[];
}
export interface NegotiateOutput {
  say: string;
  offer_minor: number;
  accept: boolean;
}

export interface ExtractInput {
  sentence: string; // 1 to 500 characters, validated by the route before this call (H3)
  today: Date; // deps.clock.now()
}
export interface ExtractOutput {
  item_title: string;
  amount_minor: number | null;
  currency: "USD" | null;
  deadline_days: number | null;
  conditions: { text: string; evidence_type: "photo" | "tracking" }[]; // 1 to 4 model conditions; appendCodeCondition() adds the code condition (D6)
  rejected: { text: string; suggestion: string }[];
  model: string;
  prompt_version: typeof EXTRACT_PROMPT_VERSION;
  raw_response: RawResponse;
}

export type ImgMime = "image/jpeg" | "image/png" | "image/webp"; // B6: what the server accepts

export interface JudgePhoto { id: string; mime: ImgMime; sha256: string; bytes: Uint8Array } // id is files.id

export interface JudgeInput {
  code: string; // deals.public_code
  conditions: { id: string; text: string; evidence_type: "photo" | "tracking" }[]; // ordered by position, 1 to 5
  reference_photos: JudgePhoto[]; // purpose reference, ordered by created_at, 0 to 4
  evidence_photos: JudgePhoto[]; // this submission, in upload order, 0 to 6
  tracking_number: string | null;
  carrier_status: "delivered" | "in_transit" | "unknown" | null; // carrierStatus(tracking_number); null when no number
  note: string | null; // at most 1,000 characters (H3)
  submission_no: 1 | 2;
}
export type Result = "pass" | "fail" | "unclear";
export interface Verdict {
  condition_id: string; // database id
  result: Result;
  confidence: number; // 0 to 1, clamped, not rounded
  reason: string;
  evidence_used: string[]; // labels (e1, r2, tracking, note)
}
export interface HashSkip {
  skipped: "hash_match";
  matches: { evidence: string; reference: string; sha256: string }[];
  latency_ms: number;
}
export interface JudgeOutput {
  verdicts: Verdict[]; // exactly one per input condition, in input order
  model: string; // "none" only on rows written by the D8 guardrail
  prompt_version: typeof JUDGE_PROMPT_VERSION | typeof GUARDRAIL_VERSION;
  raw_response: RawResponse | HashSkip;
}

export interface AiDep {
  extract(input: ExtractInput): Promise<ExtractOutput>; // throws DealError (05 section 3.6)
  judge(input: JudgeInput): Promise<JudgeOutput>; // never throws (05 section 5)
  negotiate(input: NegotiateInput): Promise<NegotiateOutput>; // throws DealError
}
