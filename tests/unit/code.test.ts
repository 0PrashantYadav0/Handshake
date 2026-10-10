// public_code (I4).
import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, CODE_RE, newPublicCode } from "@/lib/deal/code";

describe("newPublicCode()", () => {
  it("100,000 generated codes match ^HS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$ and contain none of 0, O, 1, I, L", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) {
      const c = newPublicCode();
      expect(c).toMatch(CODE_RE);
      expect(c.slice(3)).not.toMatch(/[0O1IL]/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(90_000); // 923,521 codes exist; a few collisions are expected and handled by createDeal
  });
  it("the alphabet has 31 characters, so 923,521 codes exist", () => {
    expect(CODE_ALPHABET).toHaveLength(31);
    expect(31 ** 4).toBe(923_521);
  });
  it("an injected random source can force the same code twice (createDeal retries on the unique violation)", () => {
    const fixed = () => 0; // first letter of the alphabet every time
    expect(newPublicCode(fixed)).toBe("HS-2222");
    expect(newPublicCode(fixed)).toBe(newPublicCode(fixed));
    expect(newPublicCode(() => 0.999999)).toBe("HS-ZZZZ");
  });
});
