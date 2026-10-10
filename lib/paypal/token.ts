// OAuth client-credentials token for the raw fetch calls (E1; research/paypal.md "1. Auth"). The SDK caches its own
// token privately, so this is the one small cache of our own. Cached in module scope until expires_in minus 60 s.
import { PayPalError } from "./types";

let cache: { token: string; expiresAt: number } | null = null;

export async function getToken(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (cache && Date.now() < cache.expiresAt) return cache.token;
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new PayPalError(res.status, "oauth_failed", res.headers.get("paypal-debug-id"), null);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  cache = { token: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

/** Tests only. */
export const resetTokenCache = () => void (cache = null);
