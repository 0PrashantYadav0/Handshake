// components/DealPipelineWidget.tsx pure helpers (09 section 5.6; T-37): stage aggregation in STATUS_ORDER, zero fill.
import { describe, expect, it } from "vitest";
import { formatMoney, toStages } from "@/components/DealPipelineWidget";
import { STATUS_ORDER } from "@/lib/status-labels";

const keys = { status: "status", deals: "code_count", money: "amount_usd_sum" };

describe("toStages", () => {
  it("returns the eight stages in state-machine order, zero-filled, with voided last", () => {
    const stages = toStages([{ status: "held", code_count: 3, amount_usd_sum: 240 }], keys);
    expect(stages.map((s) => s.status)).toEqual(STATUS_ORDER);
    expect(stages.at(-1)?.status).toBe("voided");
    expect(stages.find((s) => s.status === "held")).toEqual({ status: "held", deals: 3, money: 240 });
    expect(stages.filter((s) => s.status !== "held").every((s) => s.deals === 0 && s.money === 0)).toBe(true);
  });
  it("accumulates repeated rows, coerces strings, ignores unknown statuses and blanks", () => {
    const stages = toStages(
      [
        { status: "paid", code_count: "2", amount_usd_sum: "10.5" },
        { status: "paid", code_count: 1, amount_usd_sum: null },
        { status: "nope", code_count: 9, amount_usd_sum: 9 },
        { status: null, code_count: 9, amount_usd_sum: 9 },
      ],
      keys,
    );
    expect(stages.find((s) => s.status === "paid")).toEqual({ status: "paid", deals: 3, money: 10.5 });
    expect(stages.reduce((n, s) => n + s.deals, 0)).toBe(3);
  });
  it("empty rows -> eight empty stages", () => {
    expect(toStages([], keys).every((s) => s.deals === 0 && s.money === 0)).toBe(true);
  });
});

describe("formatMoney", () => {
  it("whole dollars, US style", () => {
    expect(formatMoney(1234.56)).toBe("$1,235");
    expect(formatMoney(0)).toBe("$0");
  });
});
