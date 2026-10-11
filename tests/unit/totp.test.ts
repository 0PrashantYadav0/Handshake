// trust spec §4: RFC 4226 / 6238 vectors, drift window, replay floor, base32, recovery codes.
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hashRecovery, hotp, newRecoveryCodes, newTotpSecret, otpauthUri, stepAt, totpAt, verifyTotp } from "@/lib/auth/totp";

const RFC_KEY = Buffer.from("12345678901234567890"); // RFC 4226 appendix D / RFC 6238 appendix B (SHA-1)

describe("totp", () => {
  it("matches the RFC 4226 HOTP vectors", () => {
    const want = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    want.forEach((c, i) => expect(hotp(RFC_KEY, i)).toBe(c));
  });

  it("matches the RFC 6238 SHA-1 vectors (8 digits)", () => {
    const cases: [number, string][] = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];
    for (const [t, code] of cases) expect(hotp(RFC_KEY, Math.floor(t / 30), 8)).toBe(code);
  });

  it("base32 round-trips and matches RFC 4648", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("mzxw 6ytb-oi").toString()).toBe("foobar");
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(() => base32Decode("1!")).toThrow();
  });

  it("accepts one step of drift either way and nothing further", () => {
    const secret = base32Encode(RFC_KEY);
    const t = 1_800_000_000_000;
    const s = stepAt(t);
    expect(verifyTotp(secret, totpAt(secret, t), t, null)).toBe(s);
    expect(verifyTotp(secret, totpAt(secret, t - 30_000), t, null)).toBe(s - 1);
    expect(verifyTotp(secret, totpAt(secret, t + 30_000), t, null)).toBe(s + 1);
    expect(verifyTotp(secret, totpAt(secret, t - 60_000), t, null)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, t + 60_000), t, null)).toBeNull();
  });

  it("refuses a step at or below the last used one, and malformed codes", () => {
    const secret = base32Encode(RFC_KEY);
    const t = 1_800_000_000_000;
    const code = totpAt(secret, t);
    expect(verifyTotp(secret, code, t, stepAt(t))).toBeNull();
    expect(verifyTotp(secret, code, t, stepAt(t) - 1)).toBe(stepAt(t));
    for (const bad of ["", "12345", "1234567", "abcdef", " 123456"]) expect(verifyTotp(secret, bad, t, null)).toBeNull();
  });

  it("builds an otpauth URI an authenticator understands", () => {
    const u = new URL(otpauthUri("JBSWY3DPEHPK3PXP", "a+b@test"));
    expect(u.protocol).toBe("otpauth:");
    expect(u.host).toBe("totp");
    expect(decodeURIComponent(u.pathname)).toBe("/Handshake:a+b@test");
    expect(Object.fromEntries(u.searchParams)).toEqual({ secret: "JBSWY3DPEHPK3PXP", issuer: "Handshake", algorithm: "SHA1", digits: "6", period: "30" });
  });

  it("makes 10 distinct recovery codes whose hash ignores case and dashes", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(hashRecovery(codes[0]!)).toBe(hashRecovery(codes[0]!.toLowerCase().replace("-", " ")));
  });
});
