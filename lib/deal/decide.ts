// decide() is pure and is the only path to capture and void (D9, 05 section 7).
// It imports nothing from lib/paypal/ or lib/ai/ (T-07 acceptance 4).
import { z } from "zod";

export type Decision = "capture" | "request_fix" | "void" | "buyer_review";
export type DecisionReason = "all_pass" | "fail" | "unclear" | "low_confidence" | "amount_over_limit";
export interface Limits { passThreshold: number; autoCaptureMaxMinor: number }

const LimitsZ = z.object({
  passThreshold: z.coerce.number().min(0).max(1),
  autoCaptureMaxMinor: z.coerce.number().int().min(0),
});

/** Pure. lib/env.ts calls it once at module load (LIMITS), so a malformed value fails the boot, not the first evidence submission. */
export function limitsFromEnv(env: Record<string, string | undefined> = process.env): Limits {
  return LimitsZ.parse({
    passThreshold: env.PASS_THRESHOLD ?? "0.85",
    autoCaptureMaxMinor: env.AUTO_CAPTURE_MAX_MINOR ?? "20000",
  });
}

export interface DecideVerdict { condition_id: string; result: "pass" | "fail" | "unclear"; confidence: number }
export interface DecideDeal { amount_minor: number; fix_attempts_used: number; conditions: ReadonlyArray<{ id: string }> }

export function decide(
  verdicts: ReadonlyArray<DecideVerdict>,
  deal: DecideDeal,
  limits: Limits, // required: lib/deal passes LIMITS from lib/env; tests pass literals
): { decision: Decision; reason: DecisionReason } {
  if (deal.conditions.length === 0) return { decision: "buyer_review", reason: "unclear" };
  const byId = new Map(verdicts.map((v) => [v.condition_id, v]));
  const rows = deal.conditions.map(
    (c) => byId.get(c.id) ?? { condition_id: c.id, result: "unclear" as const, confidence: 0 }, // missing verdict -> unclear
  );
  const fails = rows.filter((v) => v.result === "fail");
  if (fails.length > 0) {
    if (deal.fix_attempts_used === 0) return { decision: "request_fix", reason: "fail" };
    const hardFail = fails.some((v) => v.confidence >= limits.passThreshold); // D9: void only when the model is confident
    return { decision: hardFail ? "void" : "buyer_review", reason: "fail" };
  }
  if (rows.some((v) => v.result === "unclear")) return { decision: "buyer_review", reason: "unclear" };
  if (rows.some((v) => v.confidence < limits.passThreshold)) return { decision: "buyer_review", reason: "low_confidence" }; // exactly 0.85 passes
  if (deal.amount_minor > limits.autoCaptureMaxMinor) return { decision: "buyer_review", reason: "amount_over_limit" }; // exactly 20000 captures
  return { decision: "capture", reason: "all_pass" };
}
