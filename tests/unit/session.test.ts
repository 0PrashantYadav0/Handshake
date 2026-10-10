// 06 "Config and sessions".
import { afterEach, describe, expect, test, vi } from "vitest";
import { limitsFromEnv } from "@/lib/deal/decide";
import { LOGIN_TTL_SEC, readToken, sessionCookie, signToken } from "@/lib/auth/session";

describe("limitsFromEnv", () => {
  test("PASS_THRESHOLD unset -> 0.85, '0.9' -> 0.9, 'abc' -> throws", () => {
    expect(limitsFromEnv({}).passThreshold).toBe(0.85);
    expect(limitsFromEnv({ PASS_THRESHOLD: "0.9" }).passThreshold).toBe(0.9);
    expect(() => limitsFromEnv({ PASS_THRESHOLD: "abc" })).toThrow();
  });
  test("AUTO_CAPTURE_MAX_MINOR unset -> 20000, '5000' -> 5000, 'abc' -> throws", () => {
    expect(limitsFromEnv({}).autoCaptureMaxMinor).toBe(20000);
    expect(limitsFromEnv({ AUTO_CAPTURE_MAX_MINOR: "5000" }).autoCaptureMaxMinor).toBe(5000);
    expect(() => limitsFromEnv({ AUTO_CAPTURE_MAX_MINOR: "abc" })).toThrow();
  });
});

const SECRET = "unit-test-secret-at-least-32-characters-long";
const OTHER = "another-secret-that-is-also-32-characters";

describe("session JWT", () => {
  test("round-trips sub", async () => {
    const token = await signToken("user-1", "session", 3600, SECRET);
    expect(await readToken(token, "session", SECRET)).toBe("user-1");
  });
  test("expired -> null", async () => {
    const token = await signToken("user-1", "session", -1, SECRET);
    expect(await readToken(token, "session", SECRET)).toBeNull();
  });
  test("wrong secret -> null", async () => {
    const token = await signToken("user-1", "session", 3600, SECRET);
    expect(await readToken(token, "session", OTHER)).toBeNull();
  });
  test("login token rejected as session and vice versa", async () => {
    const login = await signToken("user-1", "login", LOGIN_TTL_SEC, SECRET);
    const session = await signToken("user-1", "session", 3600, SECRET);
    expect(await readToken(login, "session", SECRET)).toBeNull();
    expect(await readToken(session, "login", SECRET)).toBeNull();
    expect(await readToken(login, "login", SECRET)).toBe("user-1");
  });
});

describe("session cookie", () => {
  afterEach(() => vi.unstubAllEnvs());
  test("attributes", () => {
    const c = sessionCookie("tok");
    expect(c).toMatch(/^hs_session=tok;/);
    for (const attr of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) expect(c).toContain(attr);
    expect(c).not.toContain("Secure");
  });
  test("Secure only in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookie("tok")).toContain("; Secure");
  });
});
