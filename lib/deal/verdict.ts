// The verdict step (02 section 5.8; 04 section 9.1 steps 2 to 9; 05 sections 4.1, 6.1): JudgeInput from the rows, the D8 hash check,
// one model call at most per submission (Tx V), then decide() and the decision's transaction (Tx B). Re-entrant: tick() calls it again
// after a crash or a PayPal failure and it never re-judges a submission that has verdict rows. Photo bytes are opened here,
// verdict reason and raw_response sealed on write (trust spec §5).
import { GUARDRAIL_VERSION, type ImgMime, type JudgeInput, type JudgeOutput, type JudgePhoto, type Verdict } from "@/lib/ai/types";
import { carrierStatus } from "@/lib/carrier";
import { DEAL_INCLUDE, type Db, type DealRow } from "./access";
import { decide, limitsFromEnv, type Decision, type DecisionReason, type Limits } from "./decide";
import { DealError } from "./errors";
import { ruleOf } from "./contract";
import { afterCommit, applyFactTx, captureHold, lockAndLoad, voidHold } from "./facts-db";
import { voidKey } from "./keys";
import { notifyBuyerReview } from "./notify";
import { openDealRow, openFile, openVerdict, sealRaw, sealText } from "./sealed";
import { transition, TX_OPTIONS, writeEvent, type Tx } from "./transition";
import type { Deps } from "./types";

let limits: Limits | undefined;
/** PASS_THRESHOLD and AUTO_CAPTURE_MAX_MINOR, read once on first use (lib/env.ts validates them at boot; tests run on the defaults). */
export const getLimits = (): Limits => (limits ??= limitsFromEnv(process.env));

const inTx = <T>(deps: Deps, fn: (tx: Tx) => Promise<T>) => deps.db.$transaction(fn, TX_OPTIONS);
const unclear = (condition_id: string, reason: string): Verdict => ({ condition_id, result: "unclear", confidence: 0, reason, evidence_used: [] });

/** The submission the deal is on: the newest evidence rows, or fix_attempts_used + 1 when none were written. */
export const currentSubmissionNo = (deal: { fix_attempts_used: number; evidence: { submission_no: number }[] }): 1 | 2 =>
  Math.max(deal.fix_attempts_used + 1, ...deal.evidence.map((e) => e.submission_no)) as 1 | 2;

/** D8 (05 section 6.1): a byte-identical copy of a listing photo fails every photo condition at confidence 1 with no model call. */
export function hashCheck(input: JudgeInput): JudgeOutput | null {
  const refs = new Map(input.reference_photos.map((r, i) => [r.sha256, `r${i + 1}`]));
  const matches = input.evidence_photos.flatMap((e, i) => {
    const ref = refs.get(e.sha256);
    return ref ? [{ evidence: `e${i + 1}`, reference: ref, sha256: e.sha256 }] : [];
  });
  if (matches.length === 0) return null;
  const list = matches.map((m) => `${m.evidence} is the same file as listing photo ${m.reference}`).join("; ");
  return {
    verdicts: input.conditions.map((c) =>
      c.evidence_type === "photo"
        ? { condition_id: c.id, result: "fail", confidence: 1, reason: `Evidence photo ${list}; a listing photo is not proof.`, evidence_used: matches.flatMap((m) => [m.evidence, m.reference]) }
        : unclear(c.id, "Not judged: the submission was rejected before the AI was called."),
    ),
    model: "none",
    prompt_version: GUARDRAIL_VERSION,
    raw_response: { skipped: "hash_match", matches, latency_ms: 0 },
  };
}

/** 05 section 4.1: conditions by position, reference photos by created_at then id, evidence photos in upload order (evidence.position);
 *  bytes are selected explicitly (lib/db.ts omits them). labels maps r1..r4 / e1..e6 to file ids for the verdict event. */
export async function buildJudgeInput(deal: DealRow, submission_no: 1 | 2, db: Db): Promise<{ input: JudgeInput; labels: Record<string, string> }> {
  const refs = deal.files.filter((f) => f.purpose === "reference");
  const ev = deal.evidence.filter((e) => e.submission_no === submission_no);
  const filesById = new Map(deal.files.map((f) => [f.id, f]));
  const evidence = ev.filter((e) => e.kind === "photo").flatMap((e) => (e.file_id && filesById.has(e.file_id) ? [filesById.get(e.file_id)!] : []));
  const ids = [...refs, ...evidence].map((f) => f.id);
  const bytes = new Map((await db.file.findMany({ where: { id: { in: ids } }, select: { id: true, bytes: true } })).map((f) => [f.id, openFile(deal.id, f.bytes)]));
  const photo = (f: DealRow["files"][number]): JudgePhoto => ({ id: f.id, mime: f.mime as ImgMime, sha256: f.sha256, bytes: bytes.get(f.id)! });
  const tracking_number = ev.find((e) => e.kind === "tracking")?.value ?? null;
  return {
    input: {
      code: deal.public_code,
      conditions: deal.conditions.map(({ id, text, evidence_type }) => ({ id, text, evidence_type })),
      reference_photos: refs.map(photo),
      evidence_photos: evidence.map(photo),
      tracking_number,
      carrier_status: tracking_number ? carrierStatus(tracking_number) : null,
      note: ev.find((e) => e.kind === "note")?.value ?? null,
      submission_no,
    },
    labels: Object.fromEntries([...refs.map((f, i) => [`r${i + 1}`, f.id]), ...evidence.map((f, i) => [`e${i + 1}`, f.id])]),
  };
}

/** 02 section 5.8. Throws paypal_error when the decision's PayPal call fails: the verdict rows stay and the deal stays proof_submitted. */
export async function runVerdict(code: string, deps: Deps): Promise<void> {
  const deal = openDealRow(await deps.db.deal.findUniqueOrThrow({ where: { public_code: code }, include: DEAL_INCLUDE }));
  if (deal.status !== "proof_submitted") throw new DealError("invalid_state", "No verdict is pending on this deal.");
  const no = currentSubmissionNo(deal);
  let rows = deal.verdicts.filter((v) => v.submission_no === no);
  if (rows.length === 0) {
    const { input, labels } = await buildJudgeInput(deal, no, deps.db);
    const out = hashCheck(input) ?? (await deps.ai.judge(input)); // judge() never throws (05 section 5)
    rows = await inTx(deps, async (tx) => {
      const d = await lockAndLoad(tx, deal.id);
      if (d.status !== "proof_submitted") throw new DealError("invalid_state", "The deal moved on while the AI was judging.");
      const existing = d.verdicts.filter((v) => v.submission_no === no);
      if (existing.length > 0) return existing; // another runner stored its rows first: never two judgements of one submission
      await tx.verdict.createMany({
        data: out.verdicts.map((v) => ({
          deal_id: d.id, condition_id: v.condition_id, submission_no: no, result: v.result, confidence: v.confidence, reason: sealText("verdicts.reason", d.id, v.reason),
          evidence_used: v.evidence_used, model: out.model, prompt_version: out.prompt_version, raw_response: sealRaw(d.id, out.raw_response),
        })),
      });
      await writeEvent(tx, d, "ai", "verdict", {
        submission_no: no, model: out.model, prompt_version: out.prompt_version, labels,
        verdicts: out.verdicts.map(({ condition_id, result, confidence }) => ({ condition_id, result, confidence })),
      });
      return (await tx.verdict.findMany({ where: { deal_id: d.id, submission_no: no } })).map((v) => openVerdict(d.id, v));
    });
  }
  const { decision, reason } = decide(rows, { amount_minor: deal.amount_minor!, fix_attempts_used: deal.fix_attempts_used, conditions: deal.conditions }, ruleOf(deal)); // the signed rule (contract format 2)
  await act(deal, no, decision, reason, deps);
}

/** Tx B (04 section 9.1 step 9; 8.2): the decision:* transition, then the PayPal fact where there is one. */
async function act(deal: DealRow, submission_no: number, decision: Decision, reason: DecisionReason, deps: Deps): Promise<void> {
  const base = { submission_no, reason };
  const notProof = () => new DealError("invalid_state", "The deal moved on before the decision was written.");

  if (decision === "request_fix" || decision === "buyer_review") {
    const d = await inTx(deps, async (tx) => {
      const d = await lockAndLoad(tx, deal.id);
      if (d.status !== "proof_submitted") throw notProof();
      if (decision === "request_fix") await tx.deal.update({ where: { id: d.id }, data: { fix_attempts_used: 1 } });
      await transition(tx, d, decision === "request_fix" ? "held" : "in_review", "system", `decision:${decision}`, base);
      return d;
    });
    if (decision === "buyer_review") await notifyBuyerReview(deps, d);
    return;
  }

  if (decision === "capture") {
    const r = await captureHold(deal, deps);
    if (!r) return; // the hold was gone: authorization_voided applied, the deal is voided
    const done = await inTx(deps, async (tx) => {
      const d = await lockAndLoad(tx, deal.id);
      // a PAYMENT.CAPTURE.* webhook may have moved the deal first (02 section 6.9 case B): then only the fact (a no-op when already applied)
      if (d.status === "proof_submitted") await transition(tx, d, "captured", "system", "decision:capture", { ...base, capture_id: r.cap.capture_id, capture_status: r.cap.status, paypal_request_id: r.key });
      return { deal: d, result: await applyFactTx(tx, deps, d, r.fact, { source: "api", paypal_request_id: r.key }) };
    });
    await afterCommit(deps, done.deal, done.result);
    return;
  }

  if ((await voidHold(deal, deps)) === "captured") throw new DealError("invalid_state", "The payment was already captured");
  const done = await inTx(deps, async (tx) => {
    const d = await lockAndLoad(tx, deal.id);
    if (d.status !== "proof_submitted") throw notProof();
    const authorization_id = d.payment!.authorization_id!;
    await transition(tx, d, "voided", "system", "decision:void", { ...base, authorization_id });
    return { deal: d, result: await applyFactTx(tx, deps, d, { type: "authorization_voided", authorization_id }, { source: "api", paypal_request_id: voidKey(d.public_code) }) };
  });
  await afterCommit(deps, done.deal, done.result);
}
