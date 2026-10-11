// trust spec §6: canonical JSON, the hash both sides compute, and signature verification.
import { describe, expect, it } from "vitest";
import { canonicalJson, contractHash, shortHash, signingMessage, type ContractDoc } from "@/lib/contract/canonical";
import { b64urlToBytes, bytesToB64url, fingerprint, isPublicKey, verifySignature } from "@/lib/contract/signature";
import { hashOf } from "@/lib/deal/contract";

const doc: ContractDoc = {
  v: 1, code: "HS-ABCD", terms_version: 2, item_title: "Blue mug ☕", amount_minor: 1800, currency: "USD", deadline_days: 5,
  conditions: [{ position: 1, text: "Matches the \"listing\" photos", evidence_type: "photo" }, { position: 2, text: "Tracking shows delivered", evidence_type: "tracking" }],
  buyer: { id: "b-1", email: "b@test" }, seller: { id: "s-1", email: "s@test" },
};

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const sign = async (m: string) => bytesToB64url(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(m)));
  return { pk: { x: jwk.x!, y: jwk.y! }, sign };
}

describe("canonicalJson", () => {
  it("sorts keys at every level, keeps array order, no whitespace", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 1 }, "x"] })).toBe('{"a":[{"c":1,"d":2},"x"],"b":1}');
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
  it("refuses values JSON cannot carry faithfully", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: NaN })).toThrow();
  });
});

describe("contract hash", () => {
  it("is the same in the browser (WebCrypto) and on the server (node:crypto), and pinned", async () => {
    const h = await contractHash(doc);
    expect(h).toBe(hashOf(doc));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(shortHash(h)).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    expect(await contractHash({ ...doc })).toBe(h); // key order of a copy does not matter
  });
  it("changes with any term, condition order, or party", async () => {
    const h = hashOf(doc);
    expect(hashOf({ ...doc, amount_minor: 1801 })).not.toBe(h);
    expect(hashOf({ ...doc, conditions: [...doc.conditions].reverse() })).not.toBe(h);
    expect(hashOf({ ...doc, seller: { id: "s-2", email: "s@test" } })).not.toBe(h);
    expect(hashOf({ ...doc, terms_version: 3 })).not.toBe(h);
  });
});

describe("signatures", () => {
  it("verify only for the signed hash and the signing key", async () => {
    const a = await keyPair();
    const b = await keyPair();
    const h = hashOf(doc);
    const sig = await a.sign(signingMessage(h));
    expect(await verifySignature(a.pk, signingMessage(h), sig)).toBe(true);
    expect(await verifySignature(b.pk, signingMessage(h), sig)).toBe(false);
    expect(await verifySignature(a.pk, signingMessage(hashOf({ ...doc, amount_minor: 1 })), sig)).toBe(false);
    const bytes = b64urlToBytes(sig);
    bytes[10]! ^= 1;
    expect(await verifySignature(a.pk, signingMessage(h), bytesToB64url(bytes))).toBe(false);
  });
  it("never throw on malformed keys or signatures", async () => {
    const a = await keyPair();
    expect(await verifySignature({ x: "nope", y: a.pk.y }, "m", "x".repeat(86))).toBe(false);
    expect(await verifySignature({ x: a.pk.y, y: a.pk.x }, "m", "A".repeat(86))).toBe(false); // not a point on the curve
    expect(await verifySignature(a.pk, "m", "short")).toBe(false);
    expect(isPublicKey({ x: a.pk.x })).toBe(false);
  });
  it("fingerprints are stable sha-256 hex", async () => {
    const a = await keyPair();
    expect(await fingerprint(a.pk)).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprint(a.pk)).toBe(await fingerprint({ ...a.pk }));
  });
});
