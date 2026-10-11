// The user's signing keys, one per browser (trust spec §6). Revoking stops a key signing again; past signatures stay valid.
import type { PrismaClient } from "@/generated/prisma/client";
import { DealError } from "@/lib/deal/errors";

export type KeyView = { id: string; fingerprint: string; label: string | null; created_at: string; revoked_at: string | null; signatures: number };

export async function listKeys(userId: string, db: PrismaClient): Promise<KeyView[]> {
  const keys = await db.signingKey.findMany({ where: { user_id: userId }, orderBy: { created_at: "asc" }, include: { _count: { select: { signatures: true } } } });
  return keys.map((k) => ({ id: k.id, fingerprint: k.fingerprint, label: k.label, created_at: k.created_at.toISOString(), revoked_at: k.revoked_at?.toISOString() ?? null, signatures: k._count.signatures }));
}

/** Caller has done step-up. Someone else's key reads as not found. */
export async function revokeKey(userId: string, keyId: string, db: PrismaClient, now: Date): Promise<void> {
  const done = await db.signingKey.updateMany({ where: { id: keyId, user_id: userId, revoked_at: null }, data: { revoked_at: now } });
  if (done.count === 0) throw new DealError("invalid_state", "No active key with that id.");
}
