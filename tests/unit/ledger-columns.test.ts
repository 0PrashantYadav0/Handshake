// Pure /ledger formatters (08 section 8) and the status label table (09 section 4.2).
import { describe, expect, it } from "vitest";
import { eventSentence, money, pct, relTime, roleLabel, when } from "@/lib/ledger-columns";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/status-labels";

describe("ledger formatters", () => {
  it("money: USD from minor units, em dash for a draft without an amount", () => {
    expect(money(8000)).toBe("$80.00");
    expect(money(1005)).toBe("$10.05");
    expect(money(null)).toBe("—");
  });
  it("pct: rounded whole percent, em dash when there is no verdict", () => {
    expect(pct(0.92)).toBe("92%");
    expect(pct(0.995)).toBe("100%");
    expect(pct(null)).toBe("—");
  });
  it("roleLabel", () => {
    expect(roleLabel("buyer")).toBe("Buyer");
    expect(roleLabel("seller")).toBe("Seller");
  });
  it("when: local date-time or em dash", () => {
    expect(when(null)).toBe("—");
    expect(when("2026-10-29T14:05:00Z")).toMatch(/^\d{1,2} \w{3} 2026, \d{2}:\d{2}$/);
  });
  it("relTime: past, future and sub-minute", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(relTime("2026-10-10T10:00:00Z", now)).toBe("2 hours ago");
    expect(relTime("2026-10-22T12:00:00Z", now)).toBe("in 12 days");
    expect(relTime("2026-10-15T11:00:00Z", now)).toBe("in 5 days"); // 4 days 23 hours rounds up
    expect(relTime("2026-10-10T11:59:30Z", now)).toBe("just now");
    expect(relTime(null, now)).toBe("—");
  });
  it("eventSentence: plain words for known causes, raw for unknown, em dash for none", () => {
    expect(eventSentence("fact:authorization_created")).toBe("PayPal placed the hold.");
    expect(eventSentence("decision:capture")).toBe("Rule: release the payment.");
    expect(eventSentence("something:new")).toBe("something:new");
    expect(eventSentence(null)).toBe("—");
  });
});

describe("STATUS_LABEL", () => {
  it("covers the eight C1 states in order and never says 'captured'", () => {
    expect(STATUS_ORDER).toHaveLength(8);
    for (const s of STATUS_ORDER) expect(STATUS_LABEL[s]).toBeTruthy();
    expect(STATUS_LABEL.captured).toBe("Payment released");
  });
});
