// The `Me` view (04 section 3) shared by /api/me and /api/auth/demo.
import type { PrismaClient } from "@/generated/prisma/client";
import { DealError } from "@/lib/deal/errors";

export type Me = { id: string; email: string; display_name: string | null; paypal_email: string | null; created_at: string };

/** A valid cookie for a deleted user reads as signed out. */
export async function getMe(userId: string, db: PrismaClient): Promise<Me> {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw new DealError("not_signed_in");
  return { id: u.id, email: u.email, display_name: u.display_name, paypal_email: u.paypal_email, created_at: u.created_at.toISOString() };
}
