// nextStatus(): the 22 C2 rows by name, the generated disallowed test over 8 statuses x all triggers, and the named cases of 06.
import { describe, expect, it } from "vitest";
import { COMMAND_TYPES, DEAL_STATUSES, FACT_TYPES, TRIGGERS, commandError, nextStatus, type TransitionCtx, type Trigger } from "@/lib/deal/transitions";
import type { CommandType, DealStatus } from "@/lib/deal/types";

describe("nextStatus(): the 22 C2 rows", () => {
  const rows: [title: string, from: DealStatus, trigger: Trigger, ctx: TransitionCtx, to: DealStatus][] = [
    ["draft + edit_terms -> draft", "draft", "edit_terms", {}, "draft"],
    ["draft + join -> draft", "draft", "join", {}, "draft"],
    ["draft + accept by one party -> draft", "draft", "accept", { bothAccepted: false }, "draft"],
    ["draft + accept when both accepted -> terms_agreed", "draft", "accept", { bothAccepted: true }, "terms_agreed"],
    ["terms_agreed + edit_terms -> draft", "terms_agreed", "edit_terms", {}, "draft"],
    ["terms_agreed + start_payment -> terms_agreed", "terms_agreed", "start_payment", {}, "terms_agreed"],
    ["terms_agreed + fact authorization_created -> held", "terms_agreed", "authorization_created", {}, "held"],
    ["held + submit_evidence -> proof_submitted", "held", "submit_evidence", {}, "proof_submitted"],
    ["proof_submitted + decision capture -> captured", "proof_submitted", "decision", { decision: "capture" }, "captured"],
    ["proof_submitted + decision request_fix -> held", "proof_submitted", "decision", { decision: "request_fix" }, "held"],
    ["proof_submitted + decision buyer_review -> in_review", "proof_submitted", "decision", { decision: "buyer_review" }, "in_review"],
    ["proof_submitted + decision void -> voided", "proof_submitted", "decision", { decision: "void" }, "voided"],
    ["in_review + review approve -> captured", "in_review", "review", { review: "approve" }, "captured"],
    ["in_review + review reject -> voided", "in_review", "review", { review: "reject" }, "voided"],
    ["proof_submitted, in_review + fact capture_completed or capture_pending -> captured", "proof_submitted", "capture_completed", {}, "captured"],
    ["captured + fact capture_declined -> in_review", "captured", "capture_declined", {}, "in_review"],
    ["captured + fact payout_succeeded for the latest attempt -> paid", "captured", "payout_succeeded", { latestAttempt: true }, "paid"],
    ["paid + fact payout_succeeded for an earlier attempt -> paid", "paid", "payout_succeeded", { latestAttempt: false }, "paid"],
    ["draft, terms_agreed, held + cancel -> voided", "held", "cancel", {}, "voided"],
    ["held, in_review + tick past deadline_at -> voided", "in_review", "tick", {}, "voided"],
    ["draft..in_review (capture_id null) + fact authorization_voided -> voided", "proof_submitted", "authorization_voided", { captureIdSet: false }, "voided"],
    ["captured + retry_payout -> captured", "captured", "retry_payout", {}, "captured"],
  ];
  it.each(rows)("%s", (_t, from, trigger, ctx, to) => {
    expect(nextStatus(from, trigger, ctx)).toBe(to);
  });
  it("has exactly 22 rows", () => expect(rows).toHaveLength(22));

  it("multi-status rows cover every listed status", () => {
    for (const s of ["proof_submitted", "in_review"] as const) {
      expect(nextStatus(s, "capture_completed")).toBe("captured");
      expect(nextStatus(s, "capture_pending")).toBe("captured");
    }
    for (const s of ["draft", "terms_agreed", "held"] as const) expect(nextStatus(s, "cancel")).toBe("voided");
    for (const s of ["held", "in_review"] as const) expect(nextStatus(s, "tick")).toBe("voided");
    for (const s of ["draft", "terms_agreed", "held", "proof_submitted", "in_review"] as const) {
      expect(nextStatus(s, "authorization_voided", { captureIdSet: false })).toBe("voided");
      expect(nextStatus(s, "authorization_voided", { captureIdSet: true })).toBeNull();
    }
    expect(nextStatus("terms_agreed", "confirm_approval")).toBe("held"); // the command form of the authorization_created row
  });
});

describe("nextStatus(): generated disallowed test, 8 statuses x all triggers", () => {
  const ALLOWED = new Set<string>([
    "draft:edit_terms", "draft:join", "draft:accept", "draft:cancel", "draft:authorization_voided",
    "terms_agreed:edit_terms", "terms_agreed:start_payment", "terms_agreed:confirm_approval", "terms_agreed:authorization_created",
    "terms_agreed:cancel", "terms_agreed:authorization_voided",
    "held:submit_evidence", "held:cancel", "held:tick", "held:authorization_voided",
    "proof_submitted:decision", "proof_submitted:capture_completed", "proof_submitted:capture_pending", "proof_submitted:authorization_voided",
    "in_review:review", "in_review:tick", "in_review:capture_completed", "in_review:capture_pending", "in_review:authorization_voided",
    "captured:capture_declined", "captured:payout_succeeded", "captured:retry_payout",
    "paid:payout_succeeded",
  ]);
  const CTXS: TransitionCtx[] = [
    {}, { bothAccepted: true }, { bothAccepted: false }, { captureIdSet: true }, { captureIdSet: false },
    { latestAttempt: true }, { latestAttempt: false }, { review: "approve" }, { review: "reject" },
    { decision: "capture" }, { decision: "request_fix" }, { decision: "buyer_review" }, { decision: "void" },
  ];
  const pairs = DEAL_STATUSES.flatMap((s) => TRIGGERS.map((t) => [s, t] as const)).filter(([s, t]) => !ALLOWED.has(`${s}:${t}`));

  it("covers 8 statuses and 18 triggers (9 commands, tick, 7 facts, decision)", () => {
    expect(DEAL_STATUSES).toHaveLength(8);
    expect(COMMAND_TYPES).toHaveLength(9);
    expect(FACT_TYPES).toHaveLength(7);
    expect(TRIGGERS).toHaveLength(18);
    expect(pairs.length).toBe(8 * 18 - ALLOWED.size);
  });
  it.each(pairs)("%s + %s -> null under every ctx", (s, t) => {
    for (const ctx of CTXS) expect(nextStatus(s, t, ctx)).toBeNull();
  });
  it("guards: missing ctx on review / decision, latestAttempt false on captured, captureIdSet on the pre-capture statuses -> null", () => {
    expect(nextStatus("in_review", "review")).toBeNull();
    expect(nextStatus("proof_submitted", "decision")).toBeNull();
    expect(nextStatus("captured", "payout_succeeded", { latestAttempt: false })).toBeNull();
    expect(nextStatus("held", "authorization_voided", { captureIdSet: true })).toBeNull();
  });
});

describe("nextStatus() / commandError(): the named cases of 06 Transition table", () => {
  const isNull = (s: DealStatus, t: Trigger) => expect(nextStatus(s, t)).toBeNull();
  const err = (s: DealStatus, c: CommandType) => commandError(s, c);

  it("submit_evidence in proof_submitted (double submit, B8) -> invalid_state", () => {
    isNull("proof_submitted", "submit_evidence");
    expect(err("proof_submitted", "submit_evidence")).toBe("invalid_state");
  });
  it("submit_evidence in in_review, captured, paid, voided, draft, terms_agreed -> invalid_state", () => {
    for (const s of ["in_review", "captured", "paid", "voided", "draft", "terms_agreed"] as const) {
      isNull(s, "submit_evidence");
      expect(err(s, "submit_evidence")).toBe("invalid_state");
    }
  });
  it("review in held, proof_submitted, captured -> invalid_state", () => {
    for (const s of ["held", "proof_submitted", "captured"] as const) {
      expect(nextStatus(s, "review", { review: "approve" })).toBeNull();
      expect(err(s, "review")).toBe("invalid_state");
    }
  });
  it("cancel in proof_submitted, in_review, captured, paid, voided -> invalid_state", () => {
    for (const s of ["proof_submitted", "in_review", "captured", "paid", "voided"] as const) {
      isNull(s, "cancel");
      expect(err(s, "cancel")).toBe("invalid_state");
    }
  });
  it("start_payment in held -> invalid_state; in draft -> terms_not_accepted", () => {
    isNull("held", "start_payment");
    expect(err("held", "start_payment")).toBe("invalid_state");
    isNull("draft", "start_payment");
    expect(err("draft", "start_payment")).toBe("terms_not_accepted");
  });
  it("accept in terms_agreed or later -> invalid_state", () => {
    for (const s of ["terms_agreed", "held", "proof_submitted", "in_review", "captured", "paid", "voided"] as const) {
      expect(nextStatus(s, "accept", { bothAccepted: true })).toBeNull();
      expect(err(s, "accept")).toBe("invalid_state");
    }
  });
  it("edit_terms in held or later -> invalid_state", () => {
    for (const s of ["held", "proof_submitted", "in_review", "captured", "paid", "voided"] as const) {
      isNull(s, "edit_terms");
      expect(err(s, "edit_terms")).toBe("invalid_state");
    }
  });
  it("retry_payout in any status but captured -> invalid_state", () => {
    for (const s of DEAL_STATUSES.filter((x) => x !== "captured")) {
      isNull(s, "retry_payout");
      expect(err(s, "retry_payout")).toBe("invalid_state");
    }
  });
  it("confirm_approval in draft -> terms_not_accepted (02 section 3.3); in held -> invalid_state", () => {
    isNull("draft", "confirm_approval");
    expect(err("draft", "confirm_approval")).toBe("terms_not_accepted");
    isNull("held", "confirm_approval");
    expect(err("held", "confirm_approval")).toBe("invalid_state");
  });
  it("fact payout_succeeded in held -> null (no transition; a detail-only event or no-op, never invalid_state)", () => {
    isNull("held", "payout_succeeded");
  });
  it("fact capture_completed in proof_submitted and in in_review -> captured (C2: requested by a dead attempt)", () => {
    expect(nextStatus("proof_submitted", "capture_completed")).toBe("captured");
    expect(nextStatus("in_review", "capture_completed")).toBe("captured");
  });
  it("fact authorization_voided in captured -> null (status unchanged; payments.status only, C2)", () => {
    expect(nextStatus("captured", "authorization_voided", { captureIdSet: true })).toBeNull();
    expect(nextStatus("paid", "authorization_voided", { captureIdSet: true })).toBeNull();
  });
});
