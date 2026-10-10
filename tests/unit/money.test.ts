// Money and date helpers (06 "Money and date helpers").
import { describe, expect, it } from "vitest";
import { addDays, deadlineAt } from "@/lib/deal/dates";
import { formatUsd, fromPaypalValue, toPaypalValue } from "@/lib/money";

describe("toPaypalValue()", () => {
  it.each([
    [8000, "80.00"],
    [5, "0.05"],
    [1_000_000, "10000.00"], // H3 maximum
    [1, "0.01"],
    [1005, "10.05"],
  ])("toPaypalValue(%i) -> %s", (minor, s) => expect(toPaypalValue(minor)).toBe(s));
  it.each([0, -1, 1.5, NaN])("toPaypalValue(%s) throws", (minor) => expect(() => toPaypalValue(minor)).toThrow());
});

describe("fromPaypalValue()", () => {
  it.each([
    ["80.00", 8000],
    ["80.5", 8050],
    ["80", 8000],
    ["0.05", 5],
  ])("fromPaypalValue(%j) -> %i", (s, minor) => expect(fromPaypalValue(s)).toBe(minor));
  it.each(["80.005", "abc", "", "-1.00", "1e3"])("fromPaypalValue(%j) throws", (s) => expect(() => fromPaypalValue(s)).toThrow());
  it("round-trips toPaypalValue", () => {
    for (const m of [1, 99, 100, 8000, 123456, 1_000_000]) expect(fromPaypalValue(toPaypalValue(m))).toBe(m);
  });
});

describe("formatUsd()", () => {
  it("formatUsd(8000) -> $80.00", () => expect(formatUsd(8000)).toBe("$80.00"));
  it("formatUsd(5) -> $0.05", () => expect(formatUsd(5)).toBe("$0.05"));
});

describe("addDays() / deadlineAt()", () => {
  it('addDays("2026-10-20T10:00:00Z", 7) -> "2026-10-27T10:00:00Z" (no milliseconds)', () => {
    expect(addDays("2026-10-20T10:00:00Z", 7)).toBe("2026-10-27T10:00:00Z");
    expect(addDays(new Date("2026-10-20T10:00:00.123Z"), 1)).toBe("2026-10-21T10:00:00Z");
  });
  it("deadlineAt(authorizedAt, 21) is earlier than authorizedAt + 29 days for every hour of a year (property)", () => {
    const start = Date.UTC(2026, 0, 1);
    const DAY = 86_400_000;
    for (let h = 0; h < 366 * 24; h++) {
      const authorizedAt = new Date(start + h * 3_600_000);
      const deadline = new Date(deadlineAt(authorizedAt, 21)).getTime();
      expect(deadline).toBeLessThan(authorizedAt.getTime() + 29 * DAY);
      expect(deadline).toBe(authorizedAt.getTime() + 21 * DAY);
    }
  });
});
