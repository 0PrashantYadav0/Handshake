// loadDeal(): the deal with everything a view or command needs, plus the caller's role (02 section 9.2; F4).
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DealError } from "./errors";
import { openDealRow } from "./sealed";
import type { Actor, Role } from "./types";

export type Db = PrismaClient | Prisma.TransactionClient;

/** 03 "Evidence pack assembly" steps 1 to 7 (files without bytes: the global omit in lib/db.ts). Every load goes through openDealRow (trust §5). */
export const DEAL_INCLUDE = {
  buyer: true,
  seller: true,
  conditions: { orderBy: { position: "asc" } },
  files: { orderBy: [{ created_at: "asc" }, { id: "asc" }] },
  evidence: { orderBy: [{ submission_no: "asc" }, { position: "asc" }] },
  verdicts: { orderBy: { created_at: "asc" } },
  payment: true,
  payouts: { orderBy: { attempt: "asc" } },
  events: { orderBy: { id: "asc" } },
  signatures: { include: { key: true }, orderBy: [{ signed_at: "asc" }, { id: "asc" }] }, // trust spec §6
} satisfies Prisma.DealInclude;

export type DealRow = Prisma.DealGetPayload<{ include: typeof DEAL_INCLUDE }>;
export type Loaded = { deal: DealRow; role: Role | "preview" };

export async function loadDeal(db: Db, code: string, actor: Actor): Promise<Loaded> {
  const row = await db.deal.findUnique({ where: { public_code: code }, include: DEAL_INCLUDE });
  if (!row) throw new DealError("deal_not_found");
  const deal = openDealRow(row);
  if (deal.buyer_id === actor.user_id) return { deal, role: "buyer" };
  if (deal.seller_id === actor.user_id) return { deal, role: "seller" };
  if (deal.status === "draft" && deal.seller_id === null) return { deal, role: "preview" };
  throw new DealError("not_a_party");
}

/** Narrows to the roles a command allows; a preview reader is never a party. */
export function requireRole(loaded: Loaded, ...roles: Role[]): Role {
  if (loaded.role === "preview" || !roles.includes(loaded.role)) throw new DealError("not_a_party");
  return loaded.role;
}

/** Seeded deals are history, not live (F6; 02 section 3.1). */
export function requireLive(deal: { seeded: boolean }): void {
  if (deal.seeded) throw new DealError("invalid_state", "This is a historical demo deal.");
}
