// The effectful side of the state machine (02 section 5.2): the row lock, the guarded status UPDATE and the deal_events row,
// always in the caller's transaction. The pure table is transitions.ts. Every deal_events row is written by insertEvent, which
// seals the payload's contract keys (trust spec §5).
import type { Prisma } from "@/generated/prisma/client";
import { DealError } from "./errors";
import { sealPayload } from "./sealed";
import type { DealStatus, EventActor } from "./types";

export type Tx = Prisma.TransactionClient;
export const TX_OPTIONS = { timeout: 15_000 } as const;

/** SELECT ... FOR UPDATE at the top of every interactive transaction. */
export async function lockDeal(tx: Tx, dealId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "deals" WHERE "id" = ${dealId}::uuid FOR UPDATE`;
}

/** The one deal_events insert. */
export async function insertEvent(
  tx: Tx, deal_id: string, from_status: DealStatus | null, to_status: DealStatus, actor: EventActor, cause: string, payload: Record<string, unknown>,
): Promise<void> {
  await tx.dealEvent.create({ data: { deal_id, from_status, to_status, actor, cause, payload: sealPayload(deal_id, payload) } });
}

/** A deal_events row with from_status = to_status (a step that leaves the status unchanged). */
export async function writeEvent(
  tx: Tx, deal: { id: string; status: DealStatus }, actor: EventActor, cause: string, payload: Record<string, unknown>,
): Promise<void> {
  await insertEvent(tx, deal.id, deal.status, deal.status, actor, cause, payload);
}

/** Guarded UPDATE (belt and braces under the lock) plus the event; mutates deal.status. */
export async function transition(
  tx: Tx, deal: { id: string; status: DealStatus }, to: DealStatus, actor: EventActor, cause: string, payload: Record<string, unknown>,
): Promise<void> {
  const from = deal.status;
  const { count } = await tx.deal.updateMany({ where: { id: deal.id, status: from }, data: { status: to } });
  if (count !== 1) throw new DealError("invalid_state");
  await insertEvent(tx, deal.id, from, to, actor, cause, payload);
  deal.status = to;
}
