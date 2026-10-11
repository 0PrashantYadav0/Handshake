// ECDSA P-256 / SHA-256 signatures over signingMessage(hash) (trust spec §6). Browser-safe: WebCrypto only.
// Public keys travel as { x, y } (base64url, 32 bytes each); signatures as the raw 64-byte r || s, base64url.
export type PublicKey = { x: string; y: string };

const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const B64URL_64 = /^[A-Za-z0-9_-]{86}$/;

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function bytesToB64url(b: ArrayBuffer | Uint8Array): string {
  let bin = "";
  for (const x of new Uint8Array(b)) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const isPublicKey = (k: unknown): k is PublicKey =>
  !!k && typeof k === "object" && B64URL_32.test((k as PublicKey).x) && B64URL_32.test((k as PublicKey).y);
export const isSignature = (s: unknown): s is string => typeof s === "string" && B64URL_64.test(s);

/** SHA-256 hex of "P-256.<x>.<y>": the key's identity everywhere (signing_keys.fingerprint). */
export async function fingerprint(k: PublicKey): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`P-256.${k.x}.${k.y}`));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** False for a bad signature, a malformed key, or a point not on the curve. Never throws. */
export async function verifySignature(k: PublicKey, message: string, signature: string): Promise<boolean> {
  if (!isPublicKey(k) || !isSignature(signature)) return false;
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: k.x, y: k.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlToBytes(signature), new TextEncoder().encode(message));
  } catch {
    return false;
  }
}
