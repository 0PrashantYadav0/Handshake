// E6 self-verification (02 section 9.4; 04 section 11.2). PayPal's postback endpoint is not used: it rejects its own
// simulator's events. message = `${transmission_id}|${transmission_time}|${webhook_id}|${crc32(rawBody)}` with the CRC
// as an unsigned decimal, verified RSA-SHA256 against the cert fetched from PAYPAL-CERT-URL. Never throws.
import { createPublicKey, createVerify, type KeyObject } from "node:crypto";
import { crc32 } from "node:zlib";

export type VerifyResult = { result: "verified" | "unverified" | "fetch_failed"; webhook_id: string | null };
export type FetchCert = (url: string) => Promise<string>;

/** `crc32("hello") === "907060870"` (research/paypal.md section 6). The raw string is hashed, never a re-serialisation. */
export const crc32Decimal = (body: string): string => String(crc32(Buffer.from(body)));

// Keyed by cert URL for the process lifetime. The real cert is an X.509 PEM; createPublicKey accepts both a
// certificate PEM and a bare public key PEM (the unit test signs with a generated SPKI key).
const certCache = new Map<string, KeyObject>();
export const clearCertCache = (): void => certCache.clear();

const header = (headers: Record<string, string | null>, name: string): string | null =>
  Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1] ?? null;

const certUrlAllowed = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".paypal.com");
  } catch {
    return false;
  }
};

export async function verifyPaypalSignature(input: {
  headers: Record<string, string | null>;
  rawBody: string;
  webhookId: string | null; // PAYPAL_WEBHOOK_ID; the simulator's literal WEBHOOK_ID is also tried outside production
  fetchCert: FetchCert;
  env?: string; // NODE_ENV
}): Promise<VerifyResult> {
  const { headers, rawBody, fetchCert, env = process.env.NODE_ENV } = input;
  const unverified: VerifyResult = { result: "unverified", webhook_id: null };
  const [id, time, sig, certUrl, algo] = [
    "paypal-transmission-id", "paypal-transmission-time", "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo",
  ].map((n) => header(headers, n));
  if (!id || !time || !sig || !certUrl || algo !== "SHA256withRSA") return unverified;
  if (!certUrlAllowed(certUrl)) return unverified;

  let key = certCache.get(certUrl);
  if (!key) {
    let pem: string;
    try {
      pem = await fetchCert(certUrl);
    } catch {
      return { result: "fetch_failed", webhook_id: null };
    }
    try {
      key = createPublicKey(pem);
    } catch {
      return unverified;
    }
    certCache.set(certUrl, key);
  }

  const ids = env === "production"
    ? [input.webhookId].filter((w) => w && w !== "WEBHOOK_ID")
    : [...new Set([input.webhookId, "WEBHOOK_ID"])].filter(Boolean);
  const crc = crc32Decimal(rawBody);
  for (const webhookId of ids as string[]) {
    try {
      if (createVerify("SHA256").update(`${id}|${time}|${webhookId}|${crc}`).verify(key, sig, "base64")) {
        return { result: "verified", webhook_id: webhookId };
      }
    } catch {
      // malformed base64 or signature length: a bad signature, not a fetch failure
    }
  }
  return unverified;
}

const fetchCertReal: FetchCert = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`cert fetch ${res.status}`);
  return res.text();
};

/** The PayPal port's seventh method (types.ts); wired in index.ts. */
export const verifyWebhook = (rawBody: string, headers: Record<string, string | null>): Promise<VerifyResult> =>
  verifyPaypalSignature({ headers, rawBody, webhookId: process.env.PAYPAL_WEBHOOK_ID ?? null, fetchCert: fetchCertReal });
