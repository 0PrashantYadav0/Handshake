// ponytail: in-memory sliding window, so one instance only; a Postgres counter if we ever scale out.
const hits = new Map<string, number[]>();
// Map order is least recently used first. Past the cap the idlest bucket goes, so a flood of new keys can't grow memory; it can only forget idle limits.
const MAX_KEYS = 50_000;
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  hits.delete(key);
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value!);
  return allowed;
}
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 64) || "local";
