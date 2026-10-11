// createDeal, addFile and one function per Command variant (02 sections 3.1, 5.1, 5.2, 8.2; 04 sections 6 to 9).
// Every command: one interactive transaction that locks the deal row, validates against the table, writes the change and its
// deal_events row. Commands that call PayPal follow "write intent, call, write result" with no lock held during the call.
// Contract text and photo bytes are sealed on write (trust spec §5); the rows loaded here are already open.
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { requireVerifiedPayout } from "@/lib/auth/payout-email";
import { carrierStatus } from "@/lib/carrier";
import { validateFile } from "@/lib/files/validate";
import { loadDeal, requireLive, requireRole, type Loaded } from "./access";
import { newPublicCode } from "./code";
import { DealError } from "./errors";
import { afterCommit, applyFactTx, captureHold, rethrowPaypal, sendPayout, voidHold, type FactResult } from "./facts-db";
import { authKey, orderKey, payoutBatchId, strayVoidKey, voidKey } from "./keys";
import { sealFile, sealText } from "./sealed";
import { acceptanceOutcome, appendCodeCondition, validateTerms } from "./terms";
import { insertEvent, lockDeal, transition, TX_OPTIONS, writeEvent, type Tx } from "./transition";
import { commandError, nextStatus } from "./transitions";
import type { Actor, AddFileInput, Command, CreateDealInput, DealView, Deps, FileRef } from "./types";
import { runVerdict } from "./verdict";
import { buildDealView, toFileRef } from "./views";

const SIX_HOURS = 6 * 3600_000;
const NOOP: FactResult = { outcome: "noop" };

const inTx = <T>(deps: Deps, fn: (tx: Tx) => Promise<T>) => deps.db.$transaction(fn, TX_OPTIONS);

/** Lock by public_code, then load with the role; seeded deals are rejected for every command. */
async function loadLocked(tx: Tx, code: string, actor: Actor): Promise<Loaded> {
  const row = await tx.deal.findUnique({ where: { public_code: code }, select: { id: true } });
  if (!row) throw new DealError("deal_not_found");
  await lockDeal(tx, row.id);
  const loaded = await loadDeal(tx, code, actor);
  requireLive(loaded.deal);
  return loaded;
}

const textLength = (s: string | null, max: number, what: string) => {
  if (s !== null && (s.length < 1 || s.length > max)) throw new DealError("invalid_input", `${what} must be 1 to ${max} characters.`);
};

async function view(code: string, actor: Actor, deps: Deps): Promise<DealView> {
  const loaded = await loadDeal(deps.db, code, actor);
  return buildDealView(loaded.deal, requireRole(loaded, "buyer", "seller"), deps.clock.now());
}

// ---------- createDeal, addFile ----------

export async function createDeal(actor: Actor, input: CreateDealInput, deps: Deps): Promise<DealView & { rejected: { text: string; suggestion: string }[] }> {
  const text = input.text.trim();
  if (text.length < 1 || text.length > 500) throw new DealError("invalid_input", "text must be 1 to 500 characters.");
  const out = await deps.ai.extract({ sentence: text, today: deps.clock.now() });
  for (let attempt = 1; ; attempt++) {
    const code = newPublicCode();
    const conditions = appendCodeCondition(code, out.conditions);
    try {
      await inTx(deps, async (tx) => {
        const id = randomUUID(); // the AAD needs the deal id before the insert
        await tx.deal.create({
          data: {
            id, public_code: code, buyer_id: actor.user_id, source_text: sealText("deals.source_text", id, text), item_title: sealText("deals.item_title", id, out.item_title),
            amount_minor: out.amount_minor, deadline_days: out.deadline_days,
            conditions: { create: conditions.map((c, i) => ({ position: i + 1, text: sealText("conditions.text", id, c.text), evidence_type: c.evidence_type })) },
          },
        });
        await insertEvent(tx, id, null, "draft", "buyer", "create", { source_text: text, model: out.model, prompt_version: out.prompt_version, rejected: out.rejected });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 10) continue; // I4: code collision
      throw e;
    }
    return { ...(await view(code, actor, deps)), rejected: out.rejected };
  }
}

export async function addFile(code: string, actor: Actor, input: AddFileInput, deps: Deps): Promise<FileRef> {
  const meta = validateFile(input.bytes);
  const loaded = await loadDeal(deps.db, code, actor);
  const { deal } = loaded;
  const now = deps.clock.now();
  if (input.purpose === "reference") {
    requireRole(loaded, "buyer");
    requireLive(deal);
    if (deal.status !== "draft") throw new DealError("invalid_state", "Reference photos can be added only while the deal is a draft.");
    if (deal.seller_accepted_version !== null) throw new DealError("invalid_state", "Edit the terms before adding photos.");
    if (deal.files.filter((f) => f.purpose === "reference").length >= 4) throw new DealError("too_many_files", "At most 4 reference photos per deal.");
  } else {
    requireRole(loaded, "seller");
    requireLive(deal);
    if (deal.status !== "held") throw new DealError("invalid_state", "Evidence can be added only while the money is held.");
    if (deal.deadline_at && now >= deal.deadline_at) throw new DealError("invalid_state", "The deadline has passed");
    const used = new Set(deal.evidence.map((e) => e.file_id));
    if (deal.files.filter((f) => f.purpose === "evidence" && !used.has(f.id)).length >= 6) throw new DealError("too_many_files", "At most 6 evidence photos per submission.");
  }
  const file = await deps.db.file.create({
    data: { deal_id: deal.id, uploaded_by: actor.user_id, purpose: input.purpose, mime: meta.mime, size_bytes: meta.size_bytes, sha256: meta.sha256, bytes: sealFile(deal.id, input.bytes) },
  });
  return toFileRef(file, now);
}

// ---------- handle ----------

export async function handle(code: string, actor: Actor, command: Command, deps: Deps): Promise<DealView> {
  switch (command.type) {
    case "edit_terms": await editTerms(code, actor, command, deps); break;
    case "join": await join(code, actor, deps); break;
    case "accept": await accept(code, actor, command.terms_version, deps); break;
    case "start_payment": await startPayment(code, actor, deps); break;
    case "confirm_approval": await confirmApproval(code, actor, command.order_id, deps); break;
    case "cancel": await cancel(code, actor, deps); break;
    case "submit_evidence": await submitEvidence(code, actor, command, deps); break;
    case "review": await review(code, actor, command, deps); break;
    case "retry_payout": await retryPayout(code, actor, deps); break;
  }
  return view(code, actor, deps);
}

async function editTerms(code: string, actor: Actor, cmd: Extract<Command, { type: "edit_terms" }>, deps: Deps): Promise<void> {
  validateTerms(cmd);
  await inTx(deps, async (tx) => {
    const loaded = await loadLocked(tx, code, actor);
    requireRole(loaded, "buyer");
    const { deal } = loaded;
    if (!nextStatus(deal.status, "edit_terms")) throw new DealError("invalid_state", "The terms can no longer be edited.");
    if (deal.status === "terms_agreed" && deal.payment) throw new DealError("invalid_state", "Payment has started; cancel the deal to change the terms.");
    const conditions = appendCodeCondition(code, cmd.conditions);
    const changed: string[] = [];
    if (cmd.item_title !== deal.item_title) changed.push("item_title");
    if (cmd.amount_minor !== deal.amount_minor) changed.push("amount_minor");
    if (cmd.deadline_days !== deal.deadline_days) changed.push("deadline_days");
    const sameConditions =
      conditions.length === deal.conditions.length &&
      conditions.every((c, i) => c.text === deal.conditions[i]!.text && c.evidence_type === deal.conditions[i]!.evidence_type);
    if (!sameConditions) changed.push("conditions");
    const terms_version = deal.terms_version + 1;
    await tx.deal.update({
      where: { id: deal.id },
      data: { item_title: sealText("deals.item_title", deal.id, cmd.item_title), amount_minor: cmd.amount_minor, deadline_days: cmd.deadline_days, terms_version, buyer_accepted_version: null, seller_accepted_version: null },
    });
    if (!sameConditions) {
      await tx.condition.deleteMany({ where: { deal_id: deal.id } });
      await tx.condition.createMany({ data: conditions.map((c, i) => ({ deal_id: deal.id, position: i + 1, text: sealText("conditions.text", deal.id, c.text), evidence_type: c.evidence_type })) });
    }
    await transition(tx, deal, "draft", "buyer", "edit_terms", { terms_version, changed });
  });
}

async function join(code: string, actor: Actor, deps: Deps): Promise<void> {
  await inTx(deps, async (tx) => {
    const loaded = await loadLocked(tx, code, actor);
    if (loaded.role === "seller") return; // already the seller: 200 with no change
    if (loaded.role === "buyer") throw new DealError("not_a_party", "You are the buyer of this deal.");
    // preview: draft with no seller (loadDeal guarantees it)
    await tx.deal.update({ where: { id: loaded.deal.id }, data: { seller_id: actor.user_id } });
    await writeEvent(tx, loaded.deal, "seller", "join", { seller_id: actor.user_id });
  });
}

async function accept(code: string, actor: Actor, terms_version: number, deps: Deps): Promise<void> {
  await inTx(deps, async (tx) => {
    const loaded = await loadLocked(tx, code, actor);
    const role = requireRole(loaded, "buyer", "seller");
    const { deal } = loaded;
    if (deal.status !== "draft") throw new DealError("invalid_state", "The terms can be accepted only while the deal is a draft.");
    if (terms_version !== deal.terms_version) throw new DealError("terms_version_mismatch", `The terms changed; reload to see version ${deal.terms_version}.`);
    if (deal.amount_minor === null || deal.deadline_days === null) throw new DealError("invalid_input", "Set the amount and the deadline before accepting.");
    const field = role === "buyer" ? "buyer_accepted_version" : "seller_accepted_version";
    if (deal[field] === terms_version) return; // the same version twice: a no-op that still answers 200
    const to = acceptanceOutcome({ ...deal, [field]: terms_version });
    if (role === "seller" || to === "terms_agreed") requireVerifiedPayout(deal.seller); // trust spec §8
    await tx.deal.update({ where: { id: deal.id }, data: { [field]: terms_version } });
    await transition(tx, deal, to, role, "accept", { terms_version });
  });
}

async function startPayment(code: string, actor: Actor, deps: Deps): Promise<void> {
  const now = deps.clock.now();
  const intent = await inTx(deps, async (tx) => {
    const loaded = await loadLocked(tx, code, actor);
    requireRole(loaded, "buyer");
    const { deal } = loaded;
    if (deal.status !== "terms_agreed") throw new DealError(commandError(deal.status, "start_payment"), "Both parties must accept the terms before paying.");
    const p = deal.payment;
    if (p?.authorization_id) throw new DealError("invalid_state", "A PayPal hold is already pending on this deal; cancel it to start over.");
    if (p && p.status === "created" && now.getTime() - p.updated_at.getTime() < SIX_HOURS) {
      await writeEvent(tx, deal, "buyer", "start_payment", { paypal_order_id: p.paypal_order_id, order_attempt: p.order_attempts });
      return null; // reused
    }
    return { n: (p?.order_attempts ?? 0) + 1, amount_minor: deal.amount_minor!, description: deal.item_title.slice(0, 127) };
  });
  if (!intent) return;
  const order = await deps.paypal
    .createAuthorizeOrder({ code, amount_minor: intent.amount_minor, description: intent.description }, orderKey(code, intent.n))
    .catch((e) => rethrowPaypal(e, "create order"));
  await inTx(deps, async (tx) => {
    const { deal } = await loadLocked(tx, code, actor);
    if (deal.status !== "terms_agreed") throw new DealError("invalid_state", "The deal moved on while the order was being created.");
    const data = { paypal_order_id: order.paypal_order_id, status: "created" as const, order_attempts: intent.n, updated_at: now };
    await tx.payment.upsert({ where: { deal_id: deal.id }, create: { deal_id: deal.id, ...data }, update: data });
    await writeEvent(tx, deal, "buyer", "start_payment", { paypal_order_id: order.paypal_order_id, order_attempt: intent.n });
  });
}

async function confirmApproval(code: string, actor: Actor, order_id: string, deps: Deps): Promise<void> {
  const proceed = await inTx(deps, async (tx) => {
    const loaded = await loadLocked(tx, code, actor);
    requireRole(loaded, "buyer");
    const { deal } = loaded;
    const p = deal.payment;
    if (deal.status === "held" && p?.paypal_order_id === order_id) return false; // the webhook got there first (C3): nothing to do
    if (deal.status !== "terms_agreed") throw new DealError(commandError(deal.status, "confirm_approval"), "The payment cannot be confirmed in this state.");
    if (!p || p.paypal_order_id !== order_id) throw new DealError("invalid_input", "order_id does not match this deal's PayPal order.");
    await tx.payment.update({ where: { id: p.id }, data: { status: "approved" } });
    return true;
  });
  if (!proceed) return;

  const key = authKey(code);
  const auth = await deps.paypal.authorizeOrder(order_id, key).catch((e) => rethrowPaypal(e, "authorize"));

  const { deal, result } = await inTx(deps, async (tx) => {
    const { deal } = await loadLocked(tx, code, actor);
    const p = deal.payment;
    if (auth.status === "CREATED") {
      if (p?.paypal_order_id !== order_id) {
        // the order was superseded by a second start_payment: a stray hold, voided with its own key (02 section 5.3)
        await deps.paypal.voidAuthorization(auth.authorization_id, strayVoidKey(auth.authorization_id));
        await writeEvent(tx, deal, "paypal", "fact:late_authorization_voided", { authorization_id: auth.authorization_id, auth_expires_at: auth.expiration_time, source: "api", paypal_request_id: key });
        return { deal, result: NOOP };
      }
      const fact = { type: "authorization_created" as const, authorization_id: auth.authorization_id, auth_expires_at: auth.expiration_time };
      return { deal, result: await applyFactTx(tx, deps, deal, fact, { source: "api", paypal_request_id: key }) };
    }
    if (auth.status === "PENDING" && p) {
      // the hold is not placed yet: keep the ids so cancel can void it and its CREATED webhook can finish it (02 section 7)
      await tx.payment.update({
        where: { id: p.id },
        data: { authorization_id: auth.authorization_id, authorized_at: deps.clock.now(), auth_expires_at: new Date(auth.expiration_time), status: "approved" },
      });
    }
    return { deal, result: NOOP };
  });
  await afterCommit(deps, deal, result);
  if (auth.status !== "CREATED") throw new DealError("paypal_error", `PayPal did not place the hold (${auth.status})${auth.reason ? `: ${auth.reason}` : ""}`);
}

async function cancel(code: string, actor: Actor, deps: Deps): Promise<void> {
  const loaded = await loadDeal(deps.db, code, actor);
  const role = requireRole(loaded, "buyer", "seller");
  requireLive(loaded.deal);
  if (!nextStatus(loaded.deal.status, "cancel")) throw new DealError("invalid_state", "This deal can no longer be cancelled.");
  const auth = loaded.deal.payment?.authorization_id ?? null;
  if (auth && (await voidHold(loaded.deal, deps)) === "captured") throw new DealError("invalid_state", "The payment was already captured");
  const { deal, result } = await inTx(deps, async (tx) => {
    const { deal } = await loadLocked(tx, code, actor);
    if (!nextStatus(deal.status, "cancel")) throw new DealError("invalid_state", "This deal can no longer be cancelled.");
    await transition(tx, deal, "voided", role, "cancel", { authorization_id: auth, voided: auth !== null });
    const result = auth
      ? await applyFactTx(tx, deps, deal, { type: "authorization_voided", authorization_id: auth }, { source: "api", paypal_request_id: voidKey(code) })
      : NOOP;
    return { deal, result };
  });
  await afterCommit(deps, deal, result);
}

/** 04 section 9.1: Tx A validates against the rows, stores the evidence and moves held -> proof_submitted; the verdict runs after commit. */
async function submitEvidence(code: string, actor: Actor, cmd: Extract<Command, { type: "submit_evidence" }>, deps: Deps): Promise<void> {
  const { file_ids, tracking_number, note } = cmd;
  if (file_ids.length > 6) throw new DealError("too_many_files", "At most 6 evidence photos per submission.");
  textLength(tracking_number, 64, "tracking_number");
  textLength(note, 1000, "note");
  await inTx(deps, async (tx) => {
    const loaded = await loadLocked(tx, code, actor);
    requireRole(loaded, "seller");
    const { deal } = loaded;
    if (deal.status !== "held") throw new DealError("invalid_state", "Evidence can be submitted only while the money is held.");
    if (!deal.deadline_at || deps.clock.now() >= deal.deadline_at) throw new DealError("invalid_state", "The deadline has passed");
    if (file_ids.length === 0 && deal.conditions.some((c) => c.evidence_type === "photo")) throw new DealError("invalid_input", "At least one photo is required.");
    if (!tracking_number && deal.conditions.some((c) => c.evidence_type === "tracking")) throw new DealError("invalid_input", "A tracking number is required.");
    const used = new Set(deal.evidence.map((e) => e.file_id));
    const files = deal.files.filter((f) => f.purpose === "evidence" && !used.has(f.id) && file_ids.includes(f.id)); // upload order
    if (files.length !== file_ids.length || new Set(file_ids).size !== file_ids.length) {
      throw new DealError("invalid_input", "Every file id must be an evidence photo of this deal that no submission has used.");
    }
    const submission_no = deal.fix_attempts_used + 1;
    const carrier_status = tracking_number ? carrierStatus(tracking_number) : null;
    const row = (kind: "photo" | "tracking" | "note", position: number, file_id: string | null, value: string | null) =>
      ({ deal_id: deal.id, submission_no, kind, position, file_id, value: value === null ? null : sealText("evidence.value", deal.id, value), uploaded_by: actor.user_id });
    await tx.evidence.createMany({
      data: [
        ...files.map((f, i) => row("photo", i + 1, f.id, null)),
        ...(tracking_number ? [row("tracking", 0, null, tracking_number)] : []), // 03: tracking and note rows sit at position 0
        ...(note ? [row("note", 0, null, note)] : []),
      ],
    });
    await transition(tx, deal, "proof_submitted", "seller", "submit_evidence", { submission_no, file_ids: files.map((f) => f.id), tracking_number, carrier_status });
  });
  await runVerdict(code, deps);
}

/** 04 section 9.2: the stored verdicts are the intent; capture or void, then one transaction with the review:* event and the fact. */
async function review(code: string, actor: Actor, cmd: Extract<Command, { type: "review" }>, deps: Deps): Promise<void> {
  textLength(cmd.note, 1000, "note");
  const loaded = await loadDeal(deps.db, code, actor);
  requireRole(loaded, "buyer");
  requireLive(loaded.deal);
  if (loaded.deal.status !== "in_review") throw new DealError("invalid_state", "There is nothing to review on this deal.");
  const moved = () => new DealError("invalid_state", "The deal moved on while PayPal was being called.");

  if (cmd.decision === "approve") {
    const r = await captureHold(loaded.deal, deps);
    if (!r) return; // the hold was gone: authorization_voided applied
    const done = await inTx(deps, async (tx) => {
      const { deal } = await loadLocked(tx, code, actor);
      if (deal.status !== "in_review") throw moved();
      await transition(tx, deal, "captured", "buyer", "review:approve", { note: cmd.note, capture_id: r.cap.capture_id, capture_status: r.cap.status });
      return { deal, result: await applyFactTx(tx, deps, deal, r.fact, { source: "api", paypal_request_id: r.key }) };
    });
    await afterCommit(deps, done.deal, done.result);
    return;
  }

  if ((await voidHold(loaded.deal, deps)) === "captured") throw new DealError("invalid_state", "The payment was already captured");
  const done = await inTx(deps, async (tx) => {
    const { deal } = await loadLocked(tx, code, actor);
    if (deal.status !== "in_review") throw moved();
    const authorization_id = deal.payment!.authorization_id!;
    await transition(tx, deal, "voided", "buyer", "review:reject", { note: cmd.note, authorization_id });
    return { deal, result: await applyFactTx(tx, deps, deal, { type: "authorization_voided", authorization_id }, { source: "api", paypal_request_id: voidKey(code) }) };
  });
  await afterCommit(deps, done.deal, done.result);
}

/** 02 section 5.1 retry_payout; 04 section 9.4: re-send attempt n (pending, no batch id) or create n + 1 (failed; UNCLAIMED cancelled first). */
async function retryPayout(code: string, actor: Actor, deps: Deps): Promise<void> {
  const loaded = await loadDeal(deps.db, code, actor);
  requireRole(loaded, "seller");
  requireLive(loaded.deal);
  const { deal } = loaded;
  const latest = deal.payouts.at(-1);
  if (deal.status !== "captured" || deal.payment?.status !== "captured" || !latest) throw new DealError("invalid_state", "There is no payout to retry.");
  const resend = latest.status === "pending" && latest.paypal_batch_id === null;
  if (!resend && latest.status !== "failed") throw new DealError("invalid_state", "PayPal has this payout; its result will arrive by webhook.");
  requireVerifiedPayout(deal.seller, "You"); // trust spec §8
  const cancelled_item_id = !resend && latest.failure_reason === "UNCLAIMED" && latest.paypal_item_id ? latest.paypal_item_id : null;
  if (cancelled_item_id) await deps.paypal.cancelPayoutItem(cancelled_item_id).catch((e) => rethrowPaypal(e, "cancel payout item"));

  const row = await inTx(deps, async (tx) => {
    const { deal: d } = await loadLocked(tx, code, actor);
    const cur = d.payouts.at(-1);
    const email = d.seller?.paypal_email_verified_at ? d.seller.paypal_email : null;
    if (d.status !== "captured" || !cur || cur.id !== latest.id || cur.status !== latest.status || cur.paypal_batch_id !== latest.paypal_batch_id) {
      throw new DealError("invalid_state", "The payout changed; reload the deal.");
    }
    if (!email) throw new DealError("payout_email_unverified");
    const row = resend
      ? cur
      : await tx.payout.create({
          data: { deal_id: d.id, attempt: cur.attempt + 1, sender_batch_id: payoutBatchId(code, cur.attempt + 1), recipient_email: email, amount_minor: d.amount_minor!, status: "pending" },
        });
    await writeEvent(tx, d, "seller", "retry_payout", {
      attempt: row.attempt, sender_batch_id: row.sender_batch_id, paypal_batch_id: row.paypal_batch_id, status: row.status, failure_reason: row.failure_reason, cancelled_item_id,
    });
    return row;
  });
  await sendPayout(deps, row, code);
}
