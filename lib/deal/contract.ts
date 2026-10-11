// The deal's contract document and signatures (trust spec §6, §7). Server side of lib/contract.
import { createHash } from "node:crypto";
import { canonicalJson, CONTRACT_FORMAT, signingMessage, type ContractDoc } from "@/lib/contract/canonical";
import { fingerprint, verifySignature, type PublicKey } from "@/lib/contract/signature";
import type { DealRow } from "./access";
import { DealError } from "./errors";
import type { Tx } from "./transition";

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
