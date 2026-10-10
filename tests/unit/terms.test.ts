// Terms: the pure parts of 06 "Terms versioning" (D6, H3; 04 section 1.3).
import { describe, expect, it } from "vitest";
import { DealError } from "@/lib/deal/errors";
import { CODE_CONDITION, CODE_CONDITION_RE, acceptanceOutcome, appendCodeCondition, isCodeCondition, validateTerms, type TermsInput } from "@/lib/deal/terms";
import type { ConditionInput } from "@/lib/deal/types";

const code = "HS-7K2Q";
const photo = (text: string): ConditionInput => ({ text, evidence_type: "photo" });
const tracking: ConditionInput = { text: "Tracking shows delivered", evidence_type: "tracking" };
const terms = (over: Partial<TermsInput> = {}): TermsInput => ({ item_title: "Blue bike", amount_minor: 8000, deadline_days: 7, conditions: [photo("Photo shows the bike")], ...over });
const invalid = (input: TermsInput) => {
  try {
    validateTerms(input);
  } catch (e) {
    expect(e).toBeInstanceOf(DealError);
    expect((e as DealError).code).toBe("invalid_input");
    return;
  }
  throw new Error("expected invalid_input");
};

describe("appendCodeCondition() (D6)", () => {
  it("appends the code condition last when a photo condition exists", () => {
    const out = appendCodeCondition(code, [photo("Photo shows the bike"), tracking]);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ text: `Photo shows the deal code ${code} written by hand`, evidence_type: "photo" });
  });
  it("strips any existing code condition and re-appends it last (a buyer edit cannot keep or move it)", () => {
    const out = appendCodeCondition(code, [photo(CODE_CONDITION(code)), photo("Photo shows the bike"), photo(CODE_CONDITION("HS-AAAA"))]);
    expect(out.map((c) => c.text)).toEqual(["Photo shows the bike", CODE_CONDITION(code)]);
  });
  it("4 non-code photo conditions -> 5 total", () => {
    expect(appendCodeCondition(code, [1, 2, 3, 4].map((i) => photo(`Photo ${i}`)))).toHaveLength(5);
  });
  it("only a tracking condition -> no code condition", () => {
    expect(appendCodeCondition(code, [tracking])).toEqual([tracking]);
  });
  it("isCodeCondition / CODE_CONDITION_RE match the server text only", () => {
    expect(isCodeCondition(CODE_CONDITION(code))).toBe(true);
    expect(CODE_CONDITION_RE.test("Photo shows the bike")).toBe(false);
    expect(isCodeCondition(`${CODE_CONDITION(code)} and more`)).toBe(false);
  });
});

describe("validateTerms() (H3, 04 section 1.3)", () => {
  it("accepts a valid input", () => expect(() => validateTerms(terms())).not.toThrow());
  it("zero conditions -> invalid_input", () => invalid(terms({ conditions: [] })));
  it("5 non-code conditions -> invalid_input; 4 non-code plus the code condition is fine", () => {
    invalid(terms({ conditions: [1, 2, 3, 4, 5].map((i) => photo(`Photo ${i}`)) }));
    expect(() => validateTerms(terms({ conditions: [...[1, 2, 3, 4].map((i) => photo(`Photo ${i}`)), photo(CODE_CONDITION(code))] }))).not.toThrow();
  });
  it("condition text must be 1 to 200 characters", () => {
    invalid(terms({ conditions: [photo("")] }));
    invalid(terms({ conditions: [photo("x".repeat(201))] }));
    expect(() => validateTerms(terms({ conditions: [photo("x".repeat(200))] }))).not.toThrow();
  });
  it("item_title must be 1 to 80 characters", () => {
    invalid(terms({ item_title: "" }));
    invalid(terms({ item_title: "x".repeat(81) }));
  });
  it("amount_minor must be null or an integer 1 to 1,000,000", () => {
    invalid(terms({ amount_minor: 0 }));
    invalid(terms({ amount_minor: 1_000_001 }));
    invalid(terms({ amount_minor: 10.5 }));
    expect(() => validateTerms(terms({ amount_minor: null }))).not.toThrow();
    expect(() => validateTerms(terms({ amount_minor: 1_000_000 }))).not.toThrow();
  });
  it("deadline_days must be null or an integer 1 to 21", () => {
    invalid(terms({ deadline_days: 0 }));
    invalid(terms({ deadline_days: 22 }));
    invalid(terms({ deadline_days: 1.5 }));
    expect(() => validateTerms(terms({ deadline_days: null }))).not.toThrow();
    expect(() => validateTerms(terms({ deadline_days: 21 }))).not.toThrow();
  });
});

describe("acceptanceOutcome()", () => {
  it("both accepted versions equal terms_version -> terms_agreed", () => {
    expect(acceptanceOutcome({ terms_version: 2, buyer_accepted_version: 2, seller_accepted_version: 2 })).toBe("terms_agreed");
  });
  it("one of them one behind, or null -> stays draft", () => {
    expect(acceptanceOutcome({ terms_version: 2, buyer_accepted_version: 2, seller_accepted_version: 1 })).toBe("draft");
    expect(acceptanceOutcome({ terms_version: 1, buyer_accepted_version: 1, seller_accepted_version: null })).toBe("draft");
    expect(acceptanceOutcome({ terms_version: 1, buyer_accepted_version: null, seller_accepted_version: null })).toBe("draft");
  });
});
