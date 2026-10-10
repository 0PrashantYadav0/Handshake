// Which deals tick() acts on (decisions B7, C5; 02 section 5.7). Pure; the SQL in tick.ts (T-09) mirrors it.
import type { DealStatus } from "./types";

export type TickDeal = { status: DealStatus; deadline_at: string | Date | null; updated_at: string | Date; seeded: boolean };

export const STUCK_VERDICT_MS = 120_000; // proof_submitted older than 2 minutes is re-run

export function selectTickWork<T extends TickDeal>(deals: readonly T[], now: Date): { toVoid: T[]; toRerun: T[] } {
  const t = now.getTime();
  const live = deals.filter((d) => !d.seeded); // seeded deals have no PayPal objects (F6)
  return {
    toVoid: live.filter((d) => (d.status === "held" || d.status === "in_review") && d.deadline_at !== null && new Date(d.deadline_at).getTime() < t),
    toRerun: live.filter((d) => d.status === "proof_submitted" && new Date(d.updated_at).getTime() < t - STUCK_VERDICT_MS),
  };
}
