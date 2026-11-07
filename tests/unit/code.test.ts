// public_code (I4).
import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, CODE_RE, newPublicCode } from "@/lib/deal/code";

describe("newPublicCode()", () => {
  it("100,000 generated codes match CODE_RE and contain none of 0, O, 1, I, L, 5", () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      const c = newPublicCode();
      if (!CODE_RE.test(c) || /[0O1IL5]/.test(c.slice(3))) bad.push(c);
      seen.add(c);
    }
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(90_000); // 810,000 codes exist; a few collisions are expected and handled by createDeal
  });
  it("the alphabet has 30 characters, so 810,000 codes exist", () => {
    expect(CODE_ALPHABET).toHaveLength(30);
    expect(30 ** 4).toBe(810_000);
  });
  it("deals made before 5 left the alphabet still match CODE_RE", () => {
    expect(CODE_RE.test("HS-C55D")).toBe(true);
  });
  it("an injected random source can force the same code twice (createDeal retries on the unique violation)", () => {
    const fixed = () => 0; // first letter of the alphabet every time
    expect(newPublicCode(fixed)).toBe("HS-2222");
    expect(newPublicCode(fixed)).toBe(newPublicCode(fixed));
    expect(newPublicCode(() => 0.999999)).toBe("HS-ZZZZ");
  });
});
