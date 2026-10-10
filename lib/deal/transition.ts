// The effectful side of the state machine (02 section 5.2): the row lock, the guarded status UPDATE and the deal_events row,
// always in the caller's transaction. The pure table is transitions.ts.
import type { Prisma } from "@/generated/prisma/client";
import { DealError } from "./errors";
import type { DealStatus, EventActor } from "./types";

export type Tx = Prisma.TransactionClient;
export const TX_OPTIONS = { timeout: 15_000 } as const;

/** SELECT ... FOR UPDATE at the top of every interactive transaction. */
export async function lockDeal(tx: Tx, dealId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "deals" WHERE "id" = ${dealId}::uuid FOR UPDATE`;
}

/** A deal_events row with from_status = to_status (a step that leaves the status unchanged). */
export async function writeEvent(
  tx: Tx, deal: { id: string; status: DealStatus }, actor: EventActor, cause: string, payload: Record<string, unknown>,
): Promise<void> {
  await tx.dealEvent.create({
    data: { deal_id: deal.id, from_status: deal.status, to_status: deal.status, actor, cause, payload: payload as Prisma.InputJsonObject },
  });
}

/** Guarded UPDATE (belt and braces under the lock) plus the event; mutates deal.status. */
export async function transition(
  tx: Tx, deal: { id: string; status: DealStatus }, to: DealStatus, actor: EventActor, cause: string, payload: Record<string, unknown>,
): Promise<void> {
  const from = deal.status;
  const { count } = await tx.deal.updateMany({ where: { id: deal.id, status: from }, data: { status: to } });
  if (count !== 1) throw new DealError("invalid_state");
  await tx.dealEvent.create({
    data: { deal_id: deal.id, from_status: from, to_status: to, actor, cause, payload: payload as Prisma.InputJsonObject },
  });
  deal.status = to;
}
