// The deal's contract document and signatures (trust spec §6, §7). Server side of lib/contract.
import { createHash } from "node:crypto";
import { canonicalJson, CONTRACT_FORMAT, signingMessage, type ContractDoc } from "@/lib/contract/canonical";
import { fingerprint, verifySignature, type PublicKey } from "@/lib/contract/signature";
import type { DealRow } from "./access";
import { DealError } from "./errors";
import { lockDeal, TX_OPTIONS, writeEvent, type Tx } from "./transition";
import type { Deps } from "./types";

/** null until both parties are named and the amount and deadline are set: there is nothing to sign yet. */
export function contractDocOf(deal: Pick<DealRow, "public_code" | "terms_version" | "item_title" | "amount_minor" | "deadline_days" | "conditions" | "buyer" | "seller">): ContractDoc | null {
  if (!deal.seller || deal.amount_minor === null || deal.deadline_days === null) return null;
  return {
    v: CONTRACT_FORMAT, code: deal.public_code, terms_version: deal.terms_version, item_title: deal.item_title,
    amount_minor: deal.amount_minor, currency: "USD", deadline_days: deal.deadline_days,
    conditions: deal.conditions.map((c) => ({ position: c.position, text: c.text, evidence_type: c.evidence_type })),
    buyer: { id: deal.buyer.id, email: deal.buyer.email },
    seller: { id: deal.seller.id, email: deal.seller.email },
  };
}

/** Same bytes as lib/contract/canonical contractHash, synchronously. */
export const hashOf = (doc: ContractDoc) => createHash("sha256").update(canonicalJson(doc)).digest("hex");

/** The caller's key for this public key: created on first use, refused if it belongs to someone else or was revoked. */
export async function useSigningKey(tx: Tx, userId: string, pk: PublicKey, now: Date, label: string | null) {
  const fp = await fingerprint(pk);
  const existing = await tx.signingKey.findUnique({ where: { fingerprint: fp } });
  if (existing) {
    if (existing.user_id !== userId) throw new DealError("signature_invalid", "This signing key belongs to another account.");
    if (existing.revoked_at) throw new DealError("signature_invalid", "This device's signing key was revoked. Clear the site data to make a new one.");
    return existing;
  }
  return tx.signingKey.create({ data: { user_id: userId, fingerprint: fp, x: pk.x, y: pk.y, label, created_at: now } });
}

export async function checkSignature(pk: PublicKey, hash: string, signature: string): Promise<void> {
  if (!(await verifySignature(pk, signingMessage(hash), signature))) throw new DealError("signature_invalid", "The signature does not match this contract.");
}

// ---------- trust spec §7: the gate before every money step ----------

/** null when both parties signed the current terms and both signatures verify against the hash of the rows as they are now. */
export async function verifyContract(deal: DealRow): Promise<string | null> {
  const doc = contractDocOf(deal);
  if (!doc) return "there is no complete contract";
  const v = deal.terms_version;
  if (deal.buyer_accepted_version !== v || deal.seller_accepted_version !== v) return `both parties have not signed version ${v}`;
  const hash = hashOf(doc);
  for (const role of ["buyer", "seller"] as const) {
    const s = deal.signatures.find((x) => x.role === role && x.terms_version === v);
    if (!s) return `the ${role} signature for version ${v} is missing`;
    const owner = role === "buyer" ? deal.buyer_id : deal.seller_id;
    if (s.user_id !== owner || s.key.user_id !== owner) return `the ${role} signature was not made by the ${role}`;
    if (s.contract_hash !== hash) return `the terms differ from what the ${role} signed`;
    if (!(await verifySignature({ x: s.key.x, y: s.key.y }, signingMessage(hash), s.signature))) return `the ${role} signature does not verify`;
  }
  return null;
}

export const contractInvalid = (problem: string) =>
  new DealError("contract_invalid", `The contract no longer matches what both parties signed (${problem}). No money was moved.`);

/** Outside any transaction: on failure writes contract:verification_failed (under the row lock) and throws contract_invalid. */
export async function requireContract(deal: DealRow, deps: Deps, step: "start_payment" | "confirm_approval" | "capture" | "payout"): Promise<void> {
  const problem = await verifyContract(deal);
  if (!problem) return;
  await recordContractFailure(deal.id, deps, step, problem);
  throw contractInvalid(problem);
}

export async function recordContractFailure(dealId: string, deps: Deps, step: string, problem: string): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    await lockDeal(tx, dealId);
    const cur = await tx.deal.findUniqueOrThrow({ where: { id: dealId }, select: { id: true, status: true } });
    await writeEvent(tx, cur, "system", "contract:verification_failed", { step, problem });
  }, TX_OPTIONS);
  console.error(`[contract] ${step} refused for deal ${dealId}: ${problem}`);
}
