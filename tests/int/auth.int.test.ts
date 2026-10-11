// 06 "One per command": profile, demo sign-in, magic link, sign out; "Zod schemas": /api/me, magic-link, demo.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET as callback } from "@/app/api/auth/callback/route";
import { POST as demo } from "@/app/api/auth/demo/route";
import { POST as magicLink } from "@/app/api/auth/magic-link/route";
import { POST as signOut } from "@/app/api/auth/sign-out/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/me/route";
import { POST as demoVerify } from "@/app/api/auth/2fa/verify/route";
import { GET as demoCode } from "@/app/api/auth/2fa/demo-code/route";
import { POST as setup2fa } from "@/app/api/auth/2fa/setup/route";
import { POST as enable2fa } from "@/app/api/auth/2fa/enable/route";
import { LOGIN_TTL_SEC, signSession, signToken } from "@/lib/auth/session";
import { totpAt } from "@/lib/auth/totp";
import { createMagicToken } from "@/lib/auth/magic-link";
import { callRoute, makeUser, resetDb, signIn, testDeps, type TestDeps } from "./helpers";

let deps: TestDeps;
beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  vi.stubEnv("DEMO_LOGIN", "true");
  vi.stubEnv("DEMO_SELLER_PAYPAL_EMAIL", "demo-seller-pp@test");
  vi.stubEnv("APP_URL", "https://handshake.test");
});
afterEach(() => vi.unstubAllEnvs());

const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/** Demo persona: partial cookie -> demo code -> full cookie (trust spec §4). */
async function passDemo2fa(partial: string): Promise<string> {
  const { code } = await (await callRoute(demoCode, "GET", "/api/auth/2fa/demo-code", { cookie: partial })).json();
  const res = await callRoute(demoVerify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code } });
  expect(res.status).toBe(200);
  deps.clock.advance(30_000); // the next code is a new step
  return cookieOf(res);
}

describe("demo sign-in", () => {
  test("sets a partial hs_session and upserts the persona on every sign-in, restoring paypal_email after PATCH /api/me", async () => {
    const buyer = await callRoute(demo, "POST", "/api/auth/demo", { body: { persona: "buyer" } });
    expect(buyer.status).toBe(200);
    expect(buyer.headers.get("set-cookie")).toMatch(/^hs_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=900$/);
    const buyerBody = await buyer.json();
    expect(buyerBody.ok).toBe(true);
    expect(buyerBody.user).toMatchObject({ email: "demo-buyer@handshake.demo", display_name: "Demo Buyer", paypal_email: null });

    const seller = await callRoute(demo, "POST", "/api/auth/demo", { body: { persona: "seller" } });
    const partial = cookieOf(seller);
    const blocked = await callRoute(patchMe, "PATCH", "/api/me", { cookie: partial, body: { display_name: "Mallory" } });
    expect(blocked.status).toBe(401);
    expect(await errorCode(blocked)).toBe("mfa_required");
    const cookie = await passDemo2fa(partial);
    expect((await seller.json()).user).toMatchObject({ email: "demo-seller@handshake.demo", display_name: "Demo Seller", paypal_email: "demo-seller-pp@test" });

    const { code: totp } = await (await callRoute(demoCode, "GET", "/api/auth/2fa/demo-code", { cookie })).json();
    const patched = await callRoute(patchMe, "PATCH", "/api/me", { cookie, body: { paypal_email: "other@test", display_name: "Mallory", totp } });
    expect((await patched.json()).user).toMatchObject({ paypal_email: "other@test", paypal_email_verified: false, display_name: "Mallory" });

    const again = await callRoute(demo, "POST", "/api/auth/demo", { body: { persona: "seller" } });
    expect((await again.json()).user).toMatchObject({ display_name: "Demo Seller", paypal_email: "demo-seller-pp@test", paypal_email_verified: true });
    expect(await deps.db.user.count()).toBe(2);
  });

  test("DEMO_LOGIN unset -> 400 invalid_input 'Demo login is disabled.'", async () => {
    vi.stubEnv("DEMO_LOGIN", undefined);
    const res = await callRoute(demo, "POST", "/api/auth/demo", { body: { persona: "buyer" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_input", message: "Demo login is disabled." } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("persona 'judge' -> 400 invalid_input", async () => {
    const res = await callRoute(demo, "POST", "/api/auth/demo", { body: { persona: "judge" } });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_input");
  });
});

describe("magic link", () => {
  test("records one send with a callback link; callback sets a partial cookie, upserts the user and sends a new user to 2FA setup", async () => {
    const res = await callRoute(magicLink, "POST", "/api/auth/magic-link", { body: { email: "  Judge@Example.com ", next: "/deals/HS-ABCD" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deps.email.sent).toHaveLength(1);
    const link = deps.email.sent[0].text.match(/https?:\/\/\S+/)?.[0] ?? "";
    expect(deps.email.sent[0].to).toBe("judge@example.com");
    expect(link).toContain("https://handshake.test/api/auth/callback?token=");

    const url = new URL(link);
    const cb = await callRoute(callback, "GET", url.pathname + url.search);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/security/setup?next=%2Fdeals%2FHS-ABCD");
    expect(cb.headers.get("set-cookie")).toMatch(/^hs_session=.+; Max-Age=900$/);
    const user = await deps.db.user.findUnique({ where: { email: "judge@example.com" } });
    expect(user?.display_name).toBeNull();

    // the partial cookie cannot read the profile until 2FA is set up
    const partial = cookieOf(cb);
    expect(await errorCode(await callRoute(getMe, "GET", "/api/me", { cookie: partial }))).toBe("mfa_required");
    const { secret } = await (await callRoute(setup2fa, "POST", "/api/auth/2fa/setup", { cookie: partial })).json();
    const on = await callRoute(enable2fa, "POST", "/api/auth/2fa/enable", { cookie: partial, body: { code: totpAt(secret, deps.clock.now().getTime()) } });
    expect(on.status).toBe(200);
    expect(on.headers.get("set-cookie")).toMatch(/Max-Age=2592000$/);
    const me = await callRoute(getMe, "GET", "/api/me", { cookie: cookieOf(on) });
    expect((await me.json()).user.id).toBe(user?.id);

    // the next sign-in goes to the code screen instead
    const again = await callRoute(callback, "GET", `/api/auth/callback?token=${await createMagicToken("judge@example.com")}&next=/ledger`);
    expect(again.headers.get("location")).toBe("/signin/2fa?next=%2Fledger");
  });

  test("default next is /dashboard; absolute-looking next falls back", async () => {
    const token = await createMagicToken("a@test");
    const plain = await callRoute(callback, "GET", `/api/auth/callback?token=${token}`);
    expect(plain.headers.get("location")).toBe("/security/setup?next=%2Fdashboard");
    const reused = await callRoute(callback, "GET", `/api/auth/callback?token=${token}`);
    expect(reused.headers.get("location")).toBe("/signin?error=invalid_link"); // single use
    const evil = await callRoute(callback, "GET", `/api/auth/callback?token=${await createMagicToken("a@test")}&next=//evil.example`);
    expect(evil.headers.get("location")).toBe("/security/setup?next=%2Fdashboard");
    expect(await deps.db.user.count()).toBe(1); // upsert, not a second row
  });

  test("expired, tampered or session-purpose token -> 302 /signin?error=invalid_link with no Set-Cookie", async () => {
    const expired = await signToken("a@test", "login", -LOGIN_TTL_SEC);
    const tampered = (await createMagicToken("a@test")).slice(0, -3) + "xyz";
    const session = await signSession("some-user-id", true);
    for (const token of [expired, tampered, session, ""]) {
      const res = await callRoute(callback, "GET", `/api/auth/callback?token=${token}&next=/ledger`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/signin?error=invalid_link");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(await deps.db.user.count()).toBe(0);
  });

  test("not an email -> 400 invalid_input and nothing sent", async () => {
    const res = await callRoute(magicLink, "POST", "/api/auth/magic-link", { body: { email: "nope" } });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_input");
    expect(deps.email.sent).toHaveLength(0);
  });
});

test("sign out clears the cookie (Max-Age=0)", async () => {
  const res = await callRoute(signOut, "POST", "/api/auth/sign-out");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers.get("set-cookie")).toMatch(/^hs_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0$/);
});

describe("profile", () => {
  test("GET returns the profile; PATCH display_name trims and needs no step-up; paypal_email needs a code (payout-email.int.test.ts)", async () => {
    const u = await makeUser("buyer@test", { display_name: "Buyer" });
    const cookie = await signIn(u.id);
    const got = await callRoute(getMe, "GET", "/api/me", { cookie });
    expect(got.status).toBe(200);
    expect((await got.json()).user).toEqual({
      id: u.id, email: "buyer@test", display_name: "Buyer", paypal_email: null, created_at: u.created_at.toISOString(), paypal_email_verified: false, two_factor: false,
    });

    const patched = await callRoute(patchMe, "PATCH", "/api/me", { cookie, body: { display_name: "  New Name " } });
    expect(patched.status).toBe(200);
    expect((await patched.json()).user).toMatchObject({ display_name: "New Name", paypal_email: null });

    const noStepUp = await callRoute(patchMe, "PATCH", "/api/me", { cookie, body: { paypal_email: "pp2@test" } });
    expect(noStepUp.status).toBe(400);
    expect(await errorCode(noStepUp)).toBe("totp_invalid");
    expect((await deps.db.user.findUniqueOrThrow({ where: { id: u.id } })).paypal_email).toBeNull();
  });

  test("signed out -> 401 not_signed_in on GET and PATCH", async () => {
    const got = await callRoute(getMe, "GET", "/api/me");
    expect(got.status).toBe(401);
    expect(await errorCode(got)).toBe("not_signed_in");
    const patched = await callRoute(patchMe, "PATCH", "/api/me", { body: { display_name: "x" } });
    expect(patched.status).toBe(401);
    expect(await errorCode(patched)).toBe("not_signed_in");
  });

  test.each([
    ["paypal_email not an email", { paypal_email: "not-an-email" }],
    ["display_name empty", { display_name: "   " }],
    ["display_name 61 chars", { display_name: "x".repeat(61) }],
    ["both fields missing", { other: "ignored" }],
  ])("PATCH %s -> 400 invalid_input", async (_label, body) => {
    const u = await makeUser("buyer@test");
    const res = await callRoute(patchMe, "PATCH", "/api/me", { cookie: await signIn(u.id), body });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_input");
    expect((await deps.db.user.findUniqueOrThrow({ where: { id: u.id } })).display_name).toBeNull();
  });
});
