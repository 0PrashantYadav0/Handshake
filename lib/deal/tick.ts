// tick() (02 section 5.7; 04 section 12; B7, C5, E12): deadline voids for held / in_review, the verdict step for proof_submitted
// deals stuck over 2 minutes, then reconcile() for late or lost webhooks. Each deal in its own transaction; a failure lands in
// errors and the run goes on to the next deal.
import { DEAL_INCLUDE } from "./access";
import { toIso } from "./dates";
import { afterCommit, applyFactTx, lockAndLoad, voidHold, type FactResult } from "./facts-db";
import { voidKey } from "./keys";
import { reconcile } from "./reconcile";
import { openDealRow } from "./sealed";
import { selectTickWork } from "./tick-select";
import { transition, TX_OPTIONS, writeEvent, type Tx } from "./transition";
import type { Deps, TickReport } from "./types";
import { currentSubmissionNo, runVerdict } from "./verdict";

const NOOP: FactResult = { outcome: "noop" };
const UNVERIFIED_WEBHOOK_TTL_MS = 7 * 86_400_000;
const inTx = <T>(deps: Deps, fn: (tx: Tx) => Promise<T>) => deps.db.$transaction(fn, TX_OPTIONS);

export async function tick(now: Date, deps: Deps): Promise<TickReport> {
  const report: TickReport = { voided: [], verdicts_rerun: [], reconciled: [], errors: [] };
  const deals = await deps.db.deal.findMany({
    where: { seeded: false, status: { in: ["held", "in_review", "proof_submitted"] } },
    select: { id: true, public_code: true, status: true, deadline_at: true, updated_at: true, seeded: true },
  });
  const { toVoid, toRerun } = selectTickWork(deals, now);
  const attempt = async (code: string, list: string[], work: () => Promise<boolean>) => {
    try {
      if (await work()) list.push(code);
    } catch (e) {
      report.errors.push({ code, message: e instanceof Error ? e.message : String(e) });
    }
  };
  for (const d of toVoid) await attempt(d.public_code, report.voided, () => deadlineVoid(d.id, now, deps));
  for (const d of toRerun) await attempt(d.public_code, report.verdicts_rerun, () => reverify(d.id, deps));
  const r = await reconcile(now, deps);
  report.reconciled = r.reconciled;
  report.errors.push(...r.errors);
  // Bad-signature rows are only for diagnosing a misconfigured webhook; a real event is stored again when it verifies.
  await attempt("webhook_events", [], async () => {
    await deps.db.webhookEvent.deleteMany({ where: { verified: false, created_at: { lt: new Date(now.getTime() - UNVERIFIED_WEBHOOK_TTL_MS) } } });
    return false;
  });
  return report;
}

/** void-{code} first (C4 on a refusal), then tick:deadline and the authorization_voided fact under the lock. false when nothing was done. */
async function deadlineVoid(id: string, now: Date, deps: Deps): Promise<boolean> {
  const deal = openDealRow(await deps.db.deal.findUniqueOrThrow({ where: { id }, include: DEAL_INCLUDE }));
  const authorization_id = deal.payment?.authorization_id ?? null;
  if (authorization_id && (await voidHold(deal, deps)) === "captured") return false; // the money was captured: the capture path continues
  const done = await inTx(deps, async (tx) => {
    const d = await lockAndLoad(tx, id);
    if ((d.status !== "held" && d.status !== "in_review") || !d.deadline_at || d.deadline_at >= now) return null;
    await transition(tx, d, "voided", "system", "tick:deadline", { deadline_at: toIso(d.deadline_at), authorization_id });
    const result = authorization_id
      ? await applyFactTx(tx, deps, d, { type: "authorization_voided", authorization_id }, { source: "api", paypal_request_id: voidKey(d.public_code) })
      : NOOP;
    return { deal: d, result };
  });
  if (!done) return false;
  await afterCommit(deps, done.deal, done.result);
  return true;
}

/** tick:reverify under the lock, then runVerdict(), which never re-judges a submission that has verdict rows. */
async function reverify(id: string, deps: Deps): Promise<boolean> {
  const code = await inTx(deps, async (tx) => {
    const d = await lockAndLoad(tx, id);
    if (d.status !== "proof_submitted") return null;
    await writeEvent(tx, d, "system", "tick:reverify", { submission_no: currentSubmissionNo(d) });
    return d.public_code;
  });
  if (!code) return false;
  await runVerdict(code, deps);
  return true;
}
