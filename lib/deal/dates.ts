// Date helpers for deadline_at (decisions C5, I3). ISO without milliseconds: "2026-10-27T10:00:00Z".
const DAY_MS = 86_400_000;

export const toIso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export function addDays(from: string | Date, days: number): string {
  return toIso(new Date(new Date(from).getTime() + days * DAY_MS));
}

/** deadline_at = authorized_at + deadline_days (1 to 21), always inside PayPal's 29-day authorization validity. */
export const deadlineAt = (authorizedAt: string | Date, deadlineDays: number) => addDays(authorizedAt, deadlineDays);
