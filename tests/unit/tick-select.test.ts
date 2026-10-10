// selectTickWork(): 06 "Deadline selection by tick" (B7, C5, F6).
import { describe, expect, it } from "vitest";
import { DEAL_STATUSES } from "@/lib/deal/transitions";
import { selectTickWork, type TickDeal } from "@/lib/deal/tick-select";

const now = new Date("2026-10-20T10:00:00.000Z");
const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
const d = (code: string, status: TickDeal["status"], deadline_at: string | null, updated_at = at(-10 * 60_000), seeded = false) =>
  ({ code, status, deadline_at, updated_at, seeded });
const codes = (xs: { code: string }[]) => xs.map((x) => x.code);

describe("selectTickWork()", () => {
  it("held, deadline_at 1 ms before now -> in toVoid", () => {
    expect(codes(selectTickWork([d("A", "held", at(-1))], now).toVoid)).toEqual(["A"]);
  });
  it("held, deadline_at equal to now -> not selected (strictly past only)", () => {
    expect(selectTickWork([d("A", "held", at(0))], now).toVoid).toEqual([]);
  });
  it("held, deadline_at in the future -> not selected", () => {
    expect(selectTickWork([d("A", "held", at(60_000))], now).toVoid).toEqual([]);
  });
  it("in_review, deadline_at past -> in toVoid (C5)", () => {
    expect(codes(selectTickWork([d("A", "in_review", at(-1000))], now).toVoid)).toEqual(["A"]);
  });
  it("proof_submitted, updated_at 121 s ago -> in toRerun", () => {
    expect(codes(selectTickWork([d("A", "proof_submitted", at(7 * 86_400_000), at(-121_000))], now).toRerun)).toEqual(["A"]);
  });
  it("proof_submitted, updated_at 119 s ago -> not selected", () => {
    expect(selectTickWork([d("A", "proof_submitted", at(7 * 86_400_000), at(-119_000))], now).toRerun).toEqual([]);
  });
  it("captured, paid, voided, draft, terms_agreed with any deadline_at -> not selected", () => {
    for (const s of ["captured", "paid", "voided", "draft", "terms_agreed"] as const) {
      for (const dl of [null, at(-1), at(1)]) {
        const r = selectTickWork([d("A", s, dl, at(-999_000))], now);
        expect(r.toVoid).toEqual([]);
        expect(r.toRerun).toEqual([]);
      }
    }
  });
  it("any status with seeded = true -> not selected (seeded deals have no PayPal objects, F6)", () => {
    const deals = DEAL_STATUSES.map((s) => d(s, s, at(-1), at(-999_000), true));
    const r = selectTickWork(deals, now);
    expect(r.toVoid).toEqual([]);
    expect(r.toRerun).toEqual([]);
  });
  it("held with deadline_at null is never voided", () => {
    expect(selectTickWork([d("A", "held", null)], now).toVoid).toEqual([]);
  });
});
