import { afterEach, describe, expect, it } from "vitest";
import { aad, isSealed, keyring, open, openBytes, openJson, seal, sealBytes, SealError, sealJson } from "@/lib/crypto/seal";

const K1 = "k1:unit-test-key-one-at-least-32-characters";
const K2 = "k2:unit-test-key-two-at-least-32-characters";
const saved = process.env.DATA_KEYS;
afterEach(() => void (process.env.DATA_KEYS = saved));
const withKeys = (v: string) => void (process.env.DATA_KEYS = v);

describe("seal", () => {
  it("round-trips text, bytes and JSON", () => {
    withKeys(K1);
    const b = aad("deals.source_text", "d1");
    const s = seal("Blue bike, $120 — ünïcode ✓", b);
    expect(isSealed(s)).toBe(true);
    expect(s).not.toContain("bike");
    expect(open(s, b)).toBe("Blue bike, $120 — ünïcode ✓");
    const bytes = new Uint8Array([0, 1, 2, 255, 254]);
    expect([...openBytes(sealBytes(bytes, b), b)]).toEqual([...bytes]);
    expect(openJson(sealJson({ a: [1, "x"] }, b), b)).toEqual({ a: [1, "x"] });
    expect(open(seal("", b), b)).toBe("");
  });

  it("uses a fresh IV every time", () => {
    withKeys(K1);
    expect(seal("same", "x")).not.toBe(seal("same", "x"));
  });

  it("refuses a value bound to another row or column", () => {
    withKeys(K1);
    const s = seal("secret", aad("deals.source_text", "d1"));
    expect(() => open(s, aad("deals.source_text", "d2"))).toThrow(SealError);
    expect(() => open(s, aad("deals.item_title", "d1"))).toThrow(SealError);
    const b = sealBytes(new Uint8Array([1, 2, 3]), "files.bytes:f1");
    expect(() => openBytes(b, "files.bytes:f2")).toThrow(SealError);
  });

  it("refuses tampering", () => {
    withKeys(K1);
    const s = seal("amount 120", "x");
    const parts = s.split(".");
    const body = Buffer.from(parts[3]!, "base64url");
    body[0]! ^= 1;
    expect(() => open([...parts.slice(0, 3), body.toString("base64url")].join("."), "x")).toThrow(SealError);
    const b = sealBytes(new Uint8Array([9, 9, 9]), "x");
    b[b.length - 1]! ^= 1;
    expect(() => openBytes(b, "x")).toThrow(SealError);
  });

  it("refuses plaintext and malformed values", () => {
    withKeys(K1);
    expect(() => open("Blue bike", "x")).toThrow(SealError);
    expect(() => open("enc1.k1.AAAA", "x")).toThrow(SealError);
    expect(() => openBytes(new Uint8Array([1, 2, 3]), "x")).toThrow(SealError);
    expect(() => openJson({ plain: true }, "x")).toThrow(SealError);
  });

  it("rotates: the first key encrypts, every listed key decrypts, an unknown kid fails", () => {
    withKeys(K1);
    const old = seal("old", "x");
    withKeys(`${K2},${K1}`);
    expect(open(old, "x")).toBe("old");
    const fresh = seal("new", "x");
    expect(fresh.split(".")[1]).toBe("k2");
    withKeys(K1);
    expect(() => open(fresh, "x")).toThrow(/Unknown key id k2/);
  });

  it("parses the keyring strictly", () => {
    expect(keyring("a-bare-secret-of-at-least-32-characters!!").active).toBe("k1");
    expect(() => keyring("")).toThrow(/must be set/);
    expect(() => keyring("k1:short")).toThrow(/at least 32/);
    expect(() => keyring(`${K1},${K1}`)).toThrow(/duplicate/);
  });
});
