// TR-2 (trust spec §5): deal_events payload keys are sealed one by one, bound to their key and deal; the rest stays plain.
import { describe, expect, it } from "vitest";
import { SealError } from "@/lib/crypto/seal";
import { openPayload, sealPayload } from "@/lib/deal/sealed";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe("event payload sealing", () => {
  it("seals only the string contract keys and opens them back", () => {
    const p = { source_text: "I'll pay $80", note: null, tracking_number: "TRK-1", submission_no: 1, rejected: [] };
    const s = sealPayload(A, p);
    // rejected (sentence fragments) is sealed as JSON text since the review (finding 8)
    expect(s).toMatchObject({ note: null, submission_no: 1, rejected: expect.stringMatching(/^enc1\./), source_text: expect.stringMatching(/^enc1\./), tracking_number: expect.stringMatching(/^enc1\./) });
    expect(openPayload(A, s)).toEqual(p);
    expect(p.source_text).toBe("I'll pay $80"); // the caller's object is not mutated
  });

  it("seals the rejected fragments and opens them back as the same array", () => {
    const rejected = [{ text: "fast", suggestion: "Say within how many days." }];
    const s = sealPayload(A, { rejected });
    expect(JSON.stringify(s)).not.toContain("fast");
    expect(openPayload(A, s)).toEqual({ rejected });
  });

  it("refuses a value moved to another deal or another key, and plaintext", () => {
    const s = sealPayload(A, { note: "n", tracking_number: "t" });
    expect(() => openPayload(B, s)).toThrow(SealError);
    expect(() => openPayload(A, { note: s.tracking_number })).toThrow(SealError);
    expect(() => openPayload(A, { note: "plain" })).toThrow(SealError);
  });
});
