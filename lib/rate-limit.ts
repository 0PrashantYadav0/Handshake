// ponytail: in-memory sliding window, so one instance only; a Postgres counter if we ever scale out.
const hits = new Map<string, number[]>();
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}
/** True when `allow` would pass, without recording a hit: for limits that count failures only. */
export function peek(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length < limit;
}
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
