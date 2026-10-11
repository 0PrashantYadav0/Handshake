// Field encryption at rest (trust spec §5). AES-256-GCM, a random 96-bit IV per value, the 128-bit tag appended to the ciphertext.
// Strings: "enc1.<kid>.<iv>.<ciphertext+tag>" in base64url. Bytes: "E1", kid length, kid, IV, ciphertext+tag.
// The AAD binds a value to its column and row ("deals.source_text:<deal id>"), so a value copied elsewhere fails to open.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

type Keyring = { active: string; keys: Map<string, Buffer> };
let cached: { src: string; ring: Keyring } | undefined;

/** DATA_KEYS = "k2:<secret>,k1:<secret>" (first one encrypts) or one bare secret (kid k1). Each secret >= 32 chars; key = SHA-256(secret). */
export function keyring(src = process.env.DATA_KEYS ?? ""): Keyring {
  if (cached?.src === src) return cached.ring;
  const keys = new Map<string, Buffer>();
  for (const entry of src.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9_-]{1,16}):(.+)$/.exec(entry);
    const [kid, secret] = m ? [m[1]!, m[2]!] : ["k1", entry];
    if (secret.length < 32) throw new SealError(`DATA_KEYS: the secret for ${kid} must be at least 32 characters`);
    if (keys.has(kid)) throw new SealError(`DATA_KEYS: duplicate kid ${kid}`);
    keys.set(kid, createHash("sha256").update(secret, "utf8").digest());
  }
  const active = keys.keys().next().value;
  if (!active) throw new SealError("DATA_KEYS must be set");
  const ring = { active, keys };
  cached = { src, ring };
  return ring;
}

/** The AAD for one column of one row. */
export const aad = (column: string, rowId: string) => `${column}:${rowId}`;

function encrypt(plain: Buffer, binding: string): { kid: string; iv: Buffer; body: Buffer } {
  const { active, keys } = keyring();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keys.get(active)!, iv);
  c.setAAD(Buffer.from(binding, "utf8"));
  return { kid: active, iv, body: Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]) };
}

function decrypt(kid: string, iv: Buffer, body: Buffer, binding: string): Buffer {
  const key = keyring().keys.get(kid);
  if (!key) throw new SealError(`Unknown key id ${kid}`);
  if (iv.length !== 12 || body.length < 16) throw new SealError("Malformed sealed value");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(Buffer.from(binding, "utf8"));
  d.setAuthTag(body.subarray(body.length - 16));
  try {
    return Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
  } catch {
    throw new SealError("Sealed value failed authentication");
  }
}

export const isSealed = (v: string) => v.startsWith("enc1.");

export function seal(text: string, binding: string): string {
  const { kid, iv, body } = encrypt(Buffer.from(text, "utf8"), binding);
  return `enc1.${kid}.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

/** Throws SealError for plaintext, a wrong binding, an unknown kid or any tampering. */
export function open(value: string, binding: string): string {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "enc1") throw new SealError("Value is not sealed");
  return decrypt(parts[1]!, Buffer.from(parts[2]!, "base64url"), Buffer.from(parts[3]!, "base64url"), binding).toString("utf8");
}

export function sealBytes(bytes: Uint8Array, binding: string): Uint8Array<ArrayBuffer> {
  const { kid, iv, body } = encrypt(Buffer.from(bytes), binding);
  const k = Buffer.from(kid, "ascii");
  const out = new Uint8Array(3 + k.length + iv.length + body.length);
  out.set([0x45, 0x31, k.length]);
  out.set(k, 3);
  out.set(iv, 3 + k.length);
  out.set(body, 3 + k.length + iv.length);
  return out;
}

export function openBytes(bytes: Uint8Array, binding: string): Uint8Array<ArrayBuffer> {
  const b = Buffer.from(bytes);
  if (b.length < 3 || b[0] !== 0x45 || b[1] !== 0x31) throw new SealError("Bytes are not sealed");
  const n = b[2]!;
  const kid = b.subarray(3, 3 + n).toString("ascii");
  return new Uint8Array(decrypt(kid, b.subarray(3 + n, 15 + n), b.subarray(15 + n), binding));
}

/** JSON columns: stored as { sealed: "enc1…" }. */
export const sealJson = (v: unknown, binding: string) => ({ sealed: seal(JSON.stringify(v), binding) });
export function openJson(v: unknown, binding: string): unknown {
  const s = (v as { sealed?: unknown } | null)?.sealed;
  if (typeof s !== "string") throw new SealError("JSON value is not sealed");
  return JSON.parse(open(s, binding));
}
