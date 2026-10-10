// Pure builders for GET /api/dashboard/data (04 section 14; 09 section 5.2). No I/O; unit-tested with hand-built fixtures.
import type { DealEvent, DealStatus, DealView, LedgerRow, Submission } from "@/lib/deal/types";

export type Decision = "capture" | "request_fix" | "buyer_review" | "void";
export type ConfidenceBand = "< 0.70" | "0.70 - 0.84" | "0.85 - 0.94" | "0.95 - 1.00";

export type DashboardDeal = {
  code: string;
  item_title: string;
  role: "buyer" | "seller";
  status: DealStatus;
  amount_usd: number;
  held_usd: number;
  released_usd: number;
  voided_usd: number;
  created_at: string;
  deadline_at: string | null;
  decision: Decision | null;
  lowest_confidence: number | null;
  fix_attempts_used: 0 | 1;
  seeded: boolean;
};

export type DashboardVerdict = {
  deal_code: string;
  condition_text: string;
  submission_no: 1 | 2;
  result: "pass" | "fail" | "unclear";
  confidence: number;
  confidence_band: ConfidenceBand;
};

export type DashboardDecision = {
  deal_code: string;
  decision: Decision;
  decided_at: string;
  decided_on: string;
  amount_usd: number;
  is_capture: 0 | 1;
  is_request_fix: 0 | 1;
  is_buyer_review: 0 | 1;
  is_void: 0 | 1;
};

export type DashboardData = {
  generated_at: string;
  deals: DashboardDeal[];
  verdicts: DashboardVerdict[];
  decisions: DashboardDecision[];
};

const HELD: DealStatus[] = ["held", "proof_submitted", "in_review"];
const RELEASED: DealStatus[] = ["captured", "paid"];
const DECISIONS: Decision[] = ["capture", "request_fix", "buyer_review", "void"];

export const usd = (minor: number | null): number => (minor ?? 0) / 100;

/** Band edges: 0.85 is PASS_THRESHOLD and lands in the passing band (D9). */
export function confidenceBand(c: number): ConfidenceBand {
  if (c < 0.7) return "< 0.70";
  if (c < 0.85) return "0.70 - 0.84";
  if (c < 0.95) return "0.85 - 0.94";
  return "0.95 - 1.00";
}

/** `decisions` must already be in decided_at order; the newest one is the deal's decision. */
export function toDashboardDeal(row: LedgerRow, view: Pick<DealView, "fix_attempts_used" | "created_at">, decisions: DashboardDecision[]): DashboardDeal {
  const amount_usd = usd(row.amount_minor);
  return {
    code: row.code,
    item_title: row.item_title,
    role: row.role,
    status: row.status,
    amount_usd,
    held_usd: HELD.includes(row.status) ? amount_usd : 0,
    released_usd: RELEASED.includes(row.status) ? amount_usd : 0,
    voided_usd: row.status === "voided" ? amount_usd : 0,
    created_at: view.created_at,
    deadline_at: row.deadline_at,
    decision: decisions.at(-1)?.decision ?? null,
    lowest_confidence: row.lowest_confidence,
    fix_attempts_used: view.fix_attempts_used,
    seeded: row.seeded,
  };
}

/** One row per verdict, ordered by submission_no then condition position. */
export function toDashboardVerdicts(code: string, conditions: DealView["conditions"], submissions: Pick<Submission, "submission_no" | "verdicts">[]): DashboardVerdict[] {
  const pos = new Map(conditions.map((c) => [c.id, c.position] as const));
  const text = new Map(conditions.map((c) => [c.id, c.text] as const));
  return [...submissions]
    .sort((a, b) => a.submission_no - b.submission_no)
    .flatMap((s) =>
      [...s.verdicts]
        .sort((a, b) => (pos.get(a.condition_id) ?? 0) - (pos.get(b.condition_id) ?? 0))
        .map((v) => ({
          deal_code: code,
          condition_text: text.get(v.condition_id) ?? "",
          submission_no: s.submission_no,
          result: v.result,
          confidence: v.confidence,
          confidence_band: confidenceBand(v.confidence),
        })),
    );
}

/** Events whose cause is `decision:<x>` (C6), in event order. Buyer reviews are not decisions. */
export function toDecisions(code: string, amount_usd: number, events: Pick<DealEvent, "cause" | "created_at">[]): DashboardDecision[] {
  const out: DashboardDecision[] = [];
  for (const e of events) {
    const d = e.cause.startsWith("decision:") ? e.cause.slice("decision:".length) : null;
    if (!d || !DECISIONS.includes(d as Decision)) continue;
    const decision = d as Decision;
    out.push({
      deal_code: code,
      decision,
      decided_at: e.created_at,
      decided_on: e.created_at.slice(0, 10),
      amount_usd,
      is_capture: decision === "capture" ? 1 : 0,
      is_request_fix: decision === "request_fix" ? 1 : 0,
      is_buyer_review: decision === "buyer_review" ? 1 : 0,
      is_void: decision === "void" ? 1 : 0,
    });
  }
  return out;
}

export type DashboardInput = { row: LedgerRow; view: DealView; events: DealEvent[] };

/** Whole payload: deals by created_at asc, verdicts by deal then submission then position, decisions by decided_at asc. */
export function toDashboardData(items: DashboardInput[], generated_at: string): DashboardData {
  const byCreated = [...items].sort((a, b) => a.view.created_at.localeCompare(b.view.created_at));
  const deals: DashboardDeal[] = [];
  const verdicts: DashboardVerdict[] = [];
  const decisions: DashboardDecision[] = [];
  for (const { row, view, events } of byCreated) {
    const d = toDecisions(row.code, usd(row.amount_minor), events);
    deals.push(toDashboardDeal(row, view, d));
    verdicts.push(...toDashboardVerdicts(row.code, view.conditions, view.submissions));
    decisions.push(...d);
  }
  decisions.sort((a, b) => a.decided_at.localeCompare(b.decided_at));
  return { generated_at, deals, verdicts, decisions };
}
