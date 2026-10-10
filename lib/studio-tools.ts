// Server-run Studio tools (09 section 6.5; T-39). Studio declares `explain_verdict` with kind "server", so the browser
// never executes it: the route runs it here with the caller's actor, which makes lib/deal's access check (F4) the
// only access rule. Throws DealError for not_a_party / deal_not_found; the agent loop turns that into a tool error.
import { z } from "zod";
import { DealError, getDeal, getEvents } from "@/lib/deal";
import type { Actor, Deps } from "@/lib/deal/types";

export const EXPLAIN_VERDICT = "explain_verdict";

const Args = z.object({ code: z.string().trim().min(1).max(32) });

/** The deal's conditions with every verdict, the decision trail and the money trail, as one JSON string. */
export async function explainVerdict(args: unknown, actor: Actor, deps: Deps): Promise<string> {
  const parsed = Args.safeParse(args);
  if (!parsed.success) throw new DealError("invalid_input", "explain_verdict needs { code }.");
  const code = parsed.data.code.toUpperCase();
  const [deal, events] = await Promise.all([getDeal(code, actor, deps), getEvents(code, actor, deps)]); // getEvents rejects a preview reader
  if (deal.role === "preview") throw new DealError("not_a_party");
  const verdicts = deal.submissions.flatMap((s) => s.verdicts.map((v) => ({ ...v, submission_no: s.submission_no })));
  const record = {
    code: deal.code,
    status: deal.status,
    my_role: deal.role,
    amount_usd: deal.amount_minor === null ? null : deal.amount_minor / 100,
    fix_attempts_used: deal.fix_attempts_used,
    conditions: deal.conditions.map((c) => ({
      text: c.text,
      evidence_type: c.evidence_type,
      verdicts: verdicts.filter((v) => v.condition_id === c.id).map(({ submission_no, result, confidence, reason }) => ({ submission_no, result, confidence, reason })),
    })),
    decisions: deal.submissions.filter((s) => s.decision).map((s) => ({ submission_no: s.submission_no, decision: s.decision, reason: s.decision_reason, at: s.decided_at })),
    money: {
      payment: deal.payment && { status: deal.payment.status, authorized_at: deal.payment.authorized_at, capture_id: deal.payment.capture_id },
      payouts: deal.payouts.map(({ attempt, status, amount_minor, failure_reason, created_at }) => ({ attempt, status, amount_usd: amount_minor / 100, failure_reason, at: created_at })),
      events: events.filter((e) => e.actor === "paypal" || e.cause.startsWith("decision:")).map((e) => ({ at: e.created_at, cause: e.cause, to: e.to_status })),
    },
  };
  // D11: tool output is data. Condition text and reasons are quoted from the deal, never read as instructions.
  return `<deal_record untrusted="true">\n${JSON.stringify(record)}\n</deal_record>`;
}

export type ServerTools = Record<string, (args: unknown) => Promise<string>>;
export const serverTools = (actor: Actor, deps: Deps): ServerTools => ({ [EXPLAIN_VERDICT]: (args) => explainVerdict(args, actor, deps) });
