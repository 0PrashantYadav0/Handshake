// lib/dashboard-rows.ts (09 section 5.2; 04 section 14): money buckets per status, decisions from events, band edges, ordering.
import { describe, expect, it } from "vitest";
import { confidenceBand, toDashboardData, toDashboardDeal, toDashboardVerdicts, toDecisions, type DashboardInput } from "@/lib/dashboard-rows";
import { STATUS_ORDER } from "@/lib/status-labels";
import type { DealEvent, DealStatus, DealView, LedgerRow } from "@/lib/deal/types";

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  code: "HS-1", item_title: "Jacket", role: "buyer", counterparty: "Seller", amount_minor: 8000, currency: "USD", status: "held",
  deadline_at: "2026-10-27T10:00:00.000Z", last_event_cause: null, last_event_at: null, lowest_confidence: 0.9, seeded: false,
  updated_at: "2026-10-20T10:00:00.000Z", ...over,
});
const view = (over: Partial<DealView> = {}): DealView => ({
  code: "HS-1", role: "buyer", status: "held", item_title: "Jacket", source_text: "", amount_minor: 8000, currency: "USD", deadline_days: 7,
  deadline_at: null, terms_version: 1, buyer_accepted_version: 1, seller_accepted_version: 1, fix_attempts_used: 0,
  buyer: { display_name: null, email: "b@test" }, seller: null,
  conditions: [{ id: "c2", position: 2, text: "Code photo", evidence_type: "photo", system: true }, { id: "c1", position: 1, text: "Matches photos", evidence_type: "photo", system: false }],
  reference_files: [], submissions: [], payment: null, payouts: [], contract: null, seeded: false,
  created_at: "2026-10-20T10:00:00.000Z", updated_at: "2026-10-20T10:00:00.000Z", ...over,
});
const ev = (cause: string, created_at: string): DealEvent => ({ id: "1", from_status: null, to_status: "held", actor: "system", cause, payload: {}, created_at });
const v = (condition_id: string, result: "pass" | "fail" | "unclear", confidence: number) =>
  ({ condition_id, result, confidence, reason: "", evidence_used: [], model: "m", prompt_version: "p" });

describe("toDashboardDeal: money buckets", () => {
  const bucket: Record<DealStatus, "held" | "released" | "voided" | null> = {
    draft: null, terms_agreed: null, held: "held", proof_submitted: "held", in_review: "held", captured: "released", paid: "released", voided: "voided",
  };
  it.each(STATUS_ORDER)("%s lands in exactly one bucket or none", (status) => {
    const d = toDashboardDeal(row({ status }), view(), []);
    const filled = (["held", "released", "voided"] as const).filter((b) => d[`${b}_usd`] === 80);
    const zero = (["held", "released", "voided"] as const).filter((b) => d[`${b}_usd`] === 0);
    expect(filled.length + zero.length).toBe(3);
    expect(filled).toEqual(bucket[status] ? [bucket[status]] : []);
    expect(d.amount_usd).toBe(80);
  });
  it("draft with no amount is $0 everywhere; no decision yet", () => {
    const d = toDashboardDeal(row({ status: "draft", amount_minor: null }), view(), []);
    expect(d).toMatchObject({ amount_usd: 0, held_usd: 0, released_usd: 0, voided_usd: 0, decision: null, fix_attempts_used: 0 });
  });
});

describe("toDecisions", () => {
  it("request_fix then capture: two decisions in order, deal decision = capture", () => {
    const events = [ev("submit_evidence", "2026-10-21T10:00:00.000Z"), ev("decision:request_fix", "2026-10-21T10:01:00.000Z"),
      ev("review:approve", "2026-10-21T10:02:00.000Z"), ev("decision:capture", "2026-10-22T09:00:00.000Z")];
    const d = toDecisions("HS-1", 80, events);
    expect(d.map((x) => x.decision)).toEqual(["request_fix", "capture"]);
    expect(d[0]).toMatchObject({ deal_code: "HS-1", amount_usd: 80, decided_on: "2026-10-21", is_request_fix: 1, is_capture: 0, is_buyer_review: 0, is_void: 0 });
    expect(d[1]).toMatchObject({ decided_on: "2026-10-22", is_capture: 1, is_request_fix: 0 });
    expect(toDashboardDeal(row(), view({ fix_attempts_used: 1 }), d)).toMatchObject({ decision: "capture", fix_attempts_used: 1 });
  });
  it("ignores unknown decision suffixes and non-decision causes", () => {
    expect(toDecisions("HS-1", 80, [ev("decision:nope", "2026-10-21T10:00:00.000Z"), ev("tick:deadline", "2026-10-21T10:00:00.000Z")])).toEqual([]);
  });
});

describe("confidenceBand edges", () => {
  it.each([[0.69, "< 0.70"], [0.7, "0.70 - 0.84"], [0.84, "0.70 - 0.84"], [0.85, "0.85 - 0.94"], [0.94, "0.85 - 0.94"], [0.95, "0.95 - 1.00"], [1, "0.95 - 1.00"]] as const)(
    "%s -> %s", (c, band) => expect(confidenceBand(c)).toBe(band),
  );
});

describe("toDashboardVerdicts", () => {
  it("orders by submission then condition position and carries the condition text", () => {
    const out = toDashboardVerdicts("HS-1", view().conditions, [
      { submission_no: 2, verdicts: [v("c1", "pass", 0.95)] },
      { submission_no: 1, verdicts: [v("c2", "pass", 0.9), v("c1", "fail", 0.6)] },
    ]);
    expect(out.map((x) => [x.submission_no, x.condition_text, x.result, x.confidence_band])).toEqual([
      [1, "Matches photos", "fail", "< 0.70"], [1, "Code photo", "pass", "0.85 - 0.94"], [2, "Matches photos", "pass", "0.95 - 1.00"],
    ]);
    expect(out[0]).toMatchObject({ deal_code: "HS-1", confidence: 0.6 });
  });
});

describe("toDashboardData", () => {
  it("sorts deals by created_at asc and decisions by decided_at asc across deals; exact top-level keys", () => {
    const items: DashboardInput[] = [
      { row: row({ code: "B", status: "captured" }), view: view({ code: "B", created_at: "2026-10-22T00:00:00.000Z" }), events: [ev("decision:capture", "2026-10-23T00:00:00.000Z")] },
      { row: row({ code: "A", status: "voided" }), view: view({ code: "A", created_at: "2026-10-21T00:00:00.000Z" }), events: [ev("decision:void", "2026-10-24T00:00:00.000Z")] },
    ];
    const data = toDashboardData(items, "2026-10-25T00:00:00.000Z");
    expect(Object.keys(data)).toEqual(["generated_at", "deals", "verdicts", "decisions"]);
    expect(data.deals.map((d) => d.code)).toEqual(["A", "B"]);
    expect(data.decisions.map((d) => `${d.deal_code}:${d.decision}`)).toEqual(["B:capture", "A:void"]);
    expect(data.verdicts).toEqual([]);
  });
});
