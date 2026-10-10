// decide() row by row: 06 "Decision function" (26 rows), 05 section 7.1 (32 rows), and the 2,000-case property test.
import { describe, expect, it } from "vitest";
import { decide, limitsFromEnv, type DecideVerdict, type Decision, type DecisionReason, type Limits } from "@/lib/deal/decide";

const L: Limits = { passThreshold: 0.85, autoCaptureMaxMinor: 20000 };

/** "pass 0.95, fail 0.20" -> verdicts c1, c2, ...; "c1 pass@0.95" keeps the given id. */
function V(spec: string): DecideVerdict[] {
  if (spec.trim() === "") return [];
  return spec.split(",").map((s, i) => {
    const parts = s.trim().split(/[\s@]+/);
    const [id, result, conf] = parts.length === 3 ? parts : [`c${i + 1}`, ...parts];
    return { condition_id: id, result: result as DecideVerdict["result"], confidence: Number(conf) };
  });
}
const deal = (fix: number, amount: number, ids: string[]) => ({ amount_minor: amount, fix_attempts_used: fix, conditions: ids.map((id) => ({ id })) });
const idsOf = (v: DecideVerdict[]) => v.map((x) => x.condition_id);

describe("decide(): 06 Decision function rows", () => {
  const rows: [n: number, verdicts: string, fix: number, amount: number, expected: Decision, note?: string, limits?: Partial<Limits>, ids?: string[]][] = [
    [1, "pass 0.95, pass 0.90, pass 0.99", 0, 8000, "capture"],
    [2, "pass 0.85, pass 0.85", 0, 8000, "capture", "exactly 0.85 passes"],
    [3, "pass 0.84, pass 0.99", 0, 8000, "buyer_review"],
    [4, "pass 0.95, unclear 0.99", 0, 8000, "buyer_review"],
    [5, "unclear 0.10", 0, 8000, "buyer_review"],
    [6, "fail 0.99, pass 0.99", 0, 8000, "request_fix"],
    [7, "fail 0.99, pass 0.99", 1, 8000, "void"],
    [8, "fail 0.20", 0, 8000, "request_fix", "a fail is a fail at any confidence"],
    [9, "fail 0.90, unclear 0.50", 0, 8000, "request_fix"],
    [10, "fail 0.90, unclear 0.50", 1, 8000, "void"],
    [11, "pass 0.95, pass 0.95", 0, 20000, "capture", "exactly the ceiling"],
    [12, "pass 0.95, pass 0.95", 0, 20001, "buyer_review"],
    [13, "pass 0.95, pass 0.95", 1, 8000, "capture", "a used fix does not block"],
    [14, "pass 0.95, pass 0.95", 1, 20001, "buyer_review"],
    [15, "fail 0.95", 0, 20001, "request_fix", "fail is checked before the ceiling"],
    [16, "unclear 0.95", 0, 20001, "buyer_review"],
    [17, "c1 pass 0.95, c3 pass 0.95", 0, 8000, "buyer_review", "nothing for c2 (normalised to unclear 0)", undefined, ["c1", "c2", "c3"]],
    [18, "", 0, 8000, "buyer_review", "empty list (AI failure: every condition unclear 0)", undefined, ["c1", "c2"]],
    [19, "pass 0.85", 0, 8000, "buyer_review", "with passThreshold 0.90", { passThreshold: 0.9 }],
    [20, "pass 0.95", 0, 8000, "buyer_review", "with autoCaptureMaxMinor 5000", { autoCaptureMaxMinor: 5000 }],
    [21, "fail 0.20", 1, 8000, "buyer_review", "D9: a low-confidence fail on the second submission goes to the buyer, never void"],
    [22, "fail 0.85", 1, 8000, "void", "exactly the threshold is a hard fail"],
    [23, "fail 0.20, fail 0.90", 1, 8000, "void", "one hard fail is enough"],
    [24, "fail 1, unclear 0", 1, 8000, "void", "D8 rows carry confidence 1 and always void on attempt 2"],
    [25, "c1 pass 0.99", 0, 8000, "buyer_review", "missing verdict is unclear", undefined, ["c1", "c2"]],
    [26, "c1 pass 0.99, c9 fail 0.99", 0, 8000, "capture", "a verdict for an id not on the deal is ignored", undefined, ["c1"]],
  ];
  it.each(rows)("06 row %i: %s, fix %i, amount %i -> %s %s", (_n, spec, fix, amount, expected, _note, limits, ids) => {
    const v = V(spec);
    expect(decide(v, deal(fix, amount, ids ?? idsOf(v)), { ...L, ...limits }).decision).toBe(expected);
  });
});

describe("decide(): 05 section 7.1 matrix", () => {
  const rows: [n: number, verdicts: string, fix: number, amount: number, decision: Decision, reason: DecisionReason, rule: string, limits?: Partial<Limits>, ids?: string[]][] = [
    [1, "c1 pass@0.95, c2 pass@0.97, c3 pass@0.99", 0, 8000, "capture", "all_pass", "happy path"],
    [2, "c1 pass@0.85, c2 pass@0.85, c3 pass@0.85", 0, 8000, "capture", "all_pass", "confidence exactly 0.85 passes"],
    [3, "c1 pass@0.84, c2 pass@0.99", 0, 8000, "buyer_review", "low_confidence", "one confidence below threshold"],
    [4, "c1 pass@0.8499", 0, 8000, "buyer_review", "low_confidence", "just below threshold"],
    [5, "c1 pass@0.99, c2 pass@0.99", 0, 20000, "capture", "all_pass", "amount exactly the ceiling captures"],
    [6, "c1 pass@0.99, c2 pass@0.99", 0, 20001, "buyer_review", "amount_over_limit", "amount above the ceiling"],
    [7, "c1 pass@0.99, c2 pass@0.99", 1, 8000, "capture", "all_pass", "a used fix attempt does not block capture"],
    [8, "c1 unclear@0.90, c2 pass@0.99", 0, 8000, "buyer_review", "unclear", "unclear with high confidence is still unclear"],
    [9, "c1 unclear@0", 1, 8000, "buyer_review", "unclear", "unclear never voids"],
    [10, "c1 fail@0.99, c2 pass@0.99", 0, 8000, "request_fix", "fail", "first fail"],
    [11, "c1 fail@0.99, c2 pass@0.99", 1, 8000, "void", "fail", "second fail, confident"],
    [12, "c1 fail@0.10", 0, 8000, "request_fix", "fail", "first fail ignores confidence"],
    [13, "c1 fail@0.99, c2 unclear@0", 0, 8000, "request_fix", "fail", "fail outranks unclear"],
    [14, "c1 fail@0.99, c2 unclear@0", 1, 8000, "void", "fail", "fail outranks unclear, fix used"],
    [15, "c1 fail@0.99, c2 pass@0.99", 0, 50000, "request_fix", "fail", "amount is not checked on the fail path"],
    [16, "c1 unclear@0", 0, 50000, "buyer_review", "unclear", "unclear outranks the amount rule"],
    [17, "c1 pass@0.99", 0, 8000, "buyer_review", "unclear", "missing verdict is unclear", undefined, ["c1", "c2"]],
    [18, "c1 fail@0.99", 0, 8000, "request_fix", "fail", "missing verdict does not hide a fail", undefined, ["c1", "c2"]],
    [19, "", 0, 8000, "buyer_review", "unclear", "empty verdict list", undefined, ["c1"]],
    [20, "c1 pass@0.99, c9 fail@0.99", 0, 8000, "capture", "all_pass", "a verdict for an id not on the deal is ignored", undefined, ["c1"]],
    [21, "c1 pass@0.99", 0, 8000, "buyer_review", "unclear", "empty-conditions guard", undefined, []],
    [22, "c1 pass@0.90", 0, 8000, "buyer_review", "low_confidence", "env threshold honoured", { passThreshold: 0.95 }],
    [23, "c1 pass@1.0", 0, 8000, "buyer_review", "amount_over_limit", "env ceiling honoured", { autoCaptureMaxMinor: 5000 }],
    [24, "c1 pass@1.0, c2 pass@0.85, c3 pass@0.85", 1, 20000, "capture", "all_pass", "every boundary at once"],
    [25, "c1 fail@0.80, c2 pass@0.99", 1, 8000, "buyer_review", "fail", "second fail, not confident: the buyer decides (D9)"],
    [26, "c1 fail@0.85", 1, 8000, "void", "fail", "second fail at exactly the threshold voids"],
    [27, "c1 fail@0.80, c2 fail@0.90", 1, 8000, "void", "fail", "one confident fail among two is enough to void"],
    [28, "c1 fail@1.0, c2 unclear@0", 1, 8000, "void", "fail", "reused listing photo (D8 row) always voids on attempt 2"],
    [29, "c1 pass@0.84, c2 pass@0.99", 0, 50000, "buyer_review", "low_confidence", "low confidence outranks the amount rule"],
  ];
  it.each(rows)("05 row %i: %s, fix %i, amount %i -> %s / %s (%s)", (_n, spec, fix, amount, decision, reason, _rule, limits, ids) => {
    const v = V(spec);
    expect(decide(v, deal(fix, amount, ids ?? idsOf(v)), { ...L, ...limits })).toEqual({ decision, reason });
  });
  it("05 row 30: limitsFromEnv({ PASS_THRESHOLD: 'abc' }) throws (malformed env rejected)", () => {
    expect(() => limitsFromEnv({ PASS_THRESHOLD: "abc" })).toThrow();
  });
  it("05 row 31: limitsFromEnv({ PASS_THRESHOLD: '1.5' }) throws (out-of-range env rejected)", () => {
    expect(() => limitsFromEnv({ PASS_THRESHOLD: "1.5" })).toThrow();
  });
  it("05 row 32: limitsFromEnv({}) gives the defaults 0.85 and 20000", () => {
    expect(limitsFromEnv({})).toEqual({ passThreshold: 0.85, autoCaptureMaxMinor: 20000 });
  });
  it("config: AUTO_CAPTURE_MAX_MINOR 'abc' throws, '0.9' threshold honoured", () => {
    expect(() => limitsFromEnv({ AUTO_CAPTURE_MAX_MINOR: "abc" })).toThrow();
    expect(limitsFromEnv({ PASS_THRESHOLD: "0.9" }).passThreshold).toBe(0.9);
  });
});

/** mulberry32: a tiny seeded PRNG so the 2,000 cases are the same on every run. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("decide(): property test, 2,000 seeded cases (the money invariant)", () => {
  it("capture only when every deal condition has exactly one confident pass and the amount is within the ceiling; void only on a confident fail at attempt 2", () => {
    const rnd = prng(20261010);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    const results: Record<Decision, number> = { capture: 0, request_fix: 0, buyer_review: 0, void: 0 };
    for (let i = 0; i < 2000; i++) {
      const nConditions = Math.floor(rnd() * 6); // 0 to 5
      const conditions = Array.from({ length: nConditions }, (_, k) => ({ id: `c${k + 1}` }));
      const nVerdicts = Math.floor(rnd() * 7);
      const pool = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"].sort(() => rnd() - 0.5); // ids may or may not be on the deal
      const verdicts: DecideVerdict[] = pool.slice(0, nVerdicts).map((condition_id) => ({
        condition_id,
        result: pick(["pass", "fail", "unclear"] as const),
        confidence: pick([0, 0.2, 0.5, 0.84, 0.85, 0.9, 1]),
      }));
      const d = { amount_minor: pick([1, 8000, 19999, 20000, 20001, 1_000_000]), fix_attempts_used: pick([0, 1]), conditions };
      const { decision } = decide(verdicts, d, L);
      results[decision]++;
      if (decision === "capture") {
        expect(d.amount_minor).toBeLessThanOrEqual(L.autoCaptureMaxMinor);
        expect(conditions.length).toBeGreaterThan(0);
        for (const c of conditions) {
          const mine = verdicts.filter((v) => v.condition_id === c.id);
          expect(mine).toHaveLength(1);
          expect(mine[0].result).toBe("pass");
          expect(mine[0].confidence).toBeGreaterThanOrEqual(L.passThreshold);
        }
      }
      if (decision === "void") {
        expect(d.fix_attempts_used).toBe(1);
        expect(conditions.some((c) => verdicts.some((v) => v.condition_id === c.id && v.result === "fail" && v.confidence >= L.passThreshold))).toBe(true);
      }
    }
    expect(results.capture + results.void + results.request_fix + results.buyer_review).toBe(2000);
    expect(results.capture).toBeGreaterThan(0); // the generator reaches every branch
    expect(results.void).toBeGreaterThan(0);
  });
});
