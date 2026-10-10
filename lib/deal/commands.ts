// createDeal, addFile and one function per Command variant (02 sections 3.1, 5.1, 5.2, 8.2; 04 sections 6 to 9).
// Every command: one interactive transaction that locks the deal row, validates against the table, writes the change and its
// deal_events row. Commands that call PayPal follow "write intent, call, write result" with no lock held during the call.
import { Prisma } from "@/generated/prisma/client";
import { validateFile } from "@/lib/files/validate";
import { PayPalError } from "@/lib/paypal/types";
import { loadDeal, requireLive, requireRole, type DealRow, type Loaded } from "./access";
import { newPublicCode } from "./code";
import { DealError } from "./errors";
import { afterCommit, applyFactTx, captureFact, type FactResult } from "./facts-db";
import { authKey, captureKey, orderKey, strayVoidKey, voidKey } from "./keys";
import { acceptanceOutcome, appendCodeCondition, validateTerms } from "./terms";
import { lockDeal, transition, TX_OPTIONS, writeEvent, type Tx } from "./transition";
import { commandError, nextStatus } from "./transitions";
import type { Actor, AddFileInput, Command, CreateDealInput, DealView, Deps, FileRef } from "./types";
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

/** PayPalError -> paypal_error with the debug id (02 section 3.3); anything else propagates as internal_error. */
function rethrowPaypal(e: unknown, what: string): never {
  if (e instanceof PayPalError) {
    const detail = `${e.name_ ?? `HTTP ${e.status}`}${e.debug_id ? ` (debug_id ${e.debug_id})` : ""}`;
    throw new DealError("paypal_error", `PayPal ${what} failed: ${detail}`, e.debug_id ?? undefined);
  }
  throw e;
}

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
        const deal = await tx.deal.create({
          data: {
            public_code: code, buyer_id: actor.user_id, source_text: text, item_title: out.item_title,
            amount_minor: out.amount_minor, deadline_days: out.deadline_days,
            conditions: { create: conditions.map((c, i) => ({ position: i + 1, text: c.text, evidence_type: c.evidence_type })) },
          },
        });
        await tx.dealEvent.create({
          data: {
            deal_id: deal.id, from_status: null, to_status: "draft", actor: "buyer", cause: "create",
            payload: { source_text: text, model: out.model, prompt_version: out.prompt_version, rejected: out.rejected } as Prisma.InputJsonObject,
          },
        });
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
    data: { deal_id: deal.id, uploaded_by: actor.user_id, purpose: input.purpose, mime: meta.mime, size_bytes: meta.size_bytes, sha256: meta.sha256, bytes: new Uint8Array(input.bytes) },
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
    case "submit_evidence": case "review": case "retry_payout":
      throw new DealError("internal_error", "not implemented: T-10");
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
      data: { item_title: cmd.item_title, amount_minor: cmd.amount_minor, deadline_days: cmd.deadline_days, terms_version, buyer_accepted_version: null, seller_accepted_version: null },
    });
    if (!sameConditions) {
      await tx.condition.deleteMany({ where: { deal_id: deal.id } });
      await tx.condition.createMany({ data: conditions.map((c, i) => ({ deal_id: deal.id, position: i + 1, text: c.text, evidence_type: c.evidence_type })) });
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
    if ((role === "seller" || to === "terms_agreed") && !deal.seller?.paypal_email) {
      throw new DealError("paypal_email_required", "The seller must add a PayPal email before the terms can be agreed.");
    }
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
  if (auth) {
    try {
      await deps.paypal.voidAuthorization(auth, voidKey(code)); // PREVIOUSLY_VOIDED resolves as success in the adapter (C4)
    } catch (e) {
      if (e instanceof PayPalError && e.status === 422 && e.name_ !== "PREVIOUSLY_VOIDED") await captureAfterRefusedVoid(loaded.deal, actor, deps, e);
      rethrowPaypal(e, "void");
    }
  }
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

/** C4: a void refused as already captured re-sends capture-{code}-{n}, applies the capture fact and answers invalid_state. */
async function captureAfterRefusedVoid(deal: DealRow, actor: Actor, deps: Deps, voidError: PayPalError): Promise<never> {
  const code = deal.public_code;
  const key = captureKey(code, deal.payment?.capture_attempts ?? 0);
  const cap = await deps.paypal
    .captureAuthorization(deal.payment!.authorization_id!, deal.amount_minor!, key)
    .catch(() => rethrowPaypal(voidError, "void")); // the re-sent capture also failed: the original void error
  const fact = captureFact(cap);
  if (fact) {
    const applied = await inTx(deps, async (tx) => {
      const { deal: locked } = await loadLocked(tx, code, actor);
      return { deal: locked, result: await applyFactTx(tx, deps, locked, fact, { source: "api", paypal_request_id: key }) };
    });
    await afterCommit(deps, applied.deal, applied.result);
  }
  throw new DealError("invalid_state", "The payment was already captured");
}
