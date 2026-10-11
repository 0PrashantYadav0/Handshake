// trust spec §4: partial sessions, enrollment, sign-in codes, replay, lockout, recovery codes, step-up, demo codes.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as setup } from "@/app/api/auth/2fa/setup/route";
import { POST as enable } from "@/app/api/auth/2fa/enable/route";
import { POST as verify } from "@/app/api/auth/2fa/verify/route";
import { GET as demoCode } from "@/app/api/auth/2fa/demo-code/route";
import { POST as regen } from "@/app/api/auth/2fa/recovery-codes/route";
import { POST as demo } from "@/app/api/auth/demo/route";
import { GET as getMe } from "@/app/api/me/route";
import { GET as listDealsRoute, POST as createDealRoute } from "@/app/api/deals/route";
import { GET as getDealRoute } from "@/app/api/deals/[code]/route";
import { POST as acceptRoute } from "@/app/api/deals/[code]/accept/route";
import { GET as dashboardData } from "@/app/api/dashboard/data/route";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { totpAt } from "@/lib/auth/totp";
import { DEMO_TOTP_SECRETS } from "@/lib/auth/demo";
import { callRoute, makeUser, resetDb, testDeps, type TestDeps } from "./helpers";

let deps: TestDeps;
beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  vi.stubEnv("DEMO_LOGIN", "true");
});
afterEach(() => vi.unstubAllEnvs());

const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const err = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;
const partialFor = async (id: string) => `${SESSION_COOKIE}=${await signSession(id, false)}`;
const now = () => deps.clock.now().getTime();
const nextStep = () => deps.clock.advance(30_000);

/** A user with 2FA on; returns the secret, the recovery codes and a full cookie. */
async function enrolled(email = "u@test") {
  const u = await makeUser(email);
  const partial = await partialFor(u.id);
  const { secret } = await (await callRoute(setup, "POST", "/api/auth/2fa/setup", { cookie: partial })).json();
  const res = await callRoute(enable, "POST", "/api/auth/2fa/enable", { cookie: partial, body: { code: totpAt(secret, now()) } });
  expect(res.status).toBe(200);
  nextStep();
  return { u, secret: secret as string, codes: (await res.json()).recovery_codes as string[], full: cookieOf(res), partial };
}

describe("partial sessions", () => {
  test("every deal, profile and dashboard route answers 401 mfa_required", async () => {
    const u = await makeUser("p@test");
    const cookie = await partialFor(u.id);
    const calls: [Response | Promise<Response>, string][] = [
      [callRoute(getMe, "GET", "/api/me", { cookie }), "me"],
      [callRoute(listDealsRoute, "GET", "/api/deals", { cookie }), "list"],
      [callRoute(createDealRoute, "POST", "/api/deals", { cookie, body: { text: "I'll pay $10 for a mug that matches the photos" } }), "create"],
      [callRoute(getDealRoute as never, "GET", "/api/deals/HS-AAAA", { cookie, params: { code: "HS-AAAA" } }), "get"],
      [callRoute(acceptRoute as never, "POST", "/api/deals/HS-AAAA/accept", { cookie, params: { code: "HS-AAAA" }, body: { terms_version: 1 } }), "accept"],
      [callRoute(dashboardData, "GET", "/api/dashboard/data", { cookie }), "dashboard"],
    ];
    for (const [p, label] of calls) {
      const res = await p;
      expect(res.status, label).toBe(401);
      expect((await err(res)).code, label).toBe("mfa_required");
    }
  });

  test("a forged mfa claim with the wrong secret is not a session", async () => {
    const u = await makeUser("f@test");
    const forged = `${SESSION_COOKIE}=${await signSession(u.id, true, "x".repeat(40))}`;
    expect((await err(await callRoute(getMe, "GET", "/api/me", { cookie: forged }))).code).toBe("not_signed_in");
  });
});

describe("enrollment", () => {
  test("stores the secret sealed, upgrades the session, returns 10 recovery codes, stores only hashes", async () => {
    const { u, secret, codes, full } = await enrolled();
    expect(codes).toHaveLength(10);
    const row = await deps.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.totp_secret).toMatch(/^enc1\./);
    expect(row.totp_secret).not.toContain(secret);
    expect(row.totp_enabled_at).not.toBeNull();
    expect(row.recovery_codes).toHaveLength(10);
    for (const c of codes) expect(row.recovery_codes).not.toContain(c);
    expect((await callRoute(getMe, "GET", "/api/me", { cookie: full })).status).toBe(200);
  });

  test("a wrong first code leaves 2FA off; setup again replaces the pending secret", async () => {
    const u = await makeUser("w@test");
    const cookie = await partialFor(u.id);
    const first = await (await callRoute(setup, "POST", "/api/auth/2fa/setup", { cookie })).json();
    expect(first.qr_svg).toMatch(/^<svg/);
    expect(first.otpauth_uri).toContain(`secret=${first.secret}`);
    const bad = await callRoute(enable, "POST", "/api/auth/2fa/enable", { cookie, body: { code: "000000" } });
    expect((await err(bad)).code).toBe("totp_invalid");
    expect(bad.headers.get("set-cookie")).toBeNull();
    const second = await (await callRoute(setup, "POST", "/api/auth/2fa/setup", { cookie })).json();
    const stale = await callRoute(enable, "POST", "/api/auth/2fa/enable", { cookie, body: { code: totpAt(first.secret, now()) } });
    expect((await err(stale)).code).toBe("totp_invalid");
    const ok = await callRoute(enable, "POST", "/api/auth/2fa/enable", { cookie, body: { code: totpAt(second.secret, now()) } });
    expect(ok.status).toBe(200);
  });

  test("setup and enable are refused once 2FA is on (no silent reset by a session thief)", async () => {
    const { secret, partial } = await enrolled();
    expect((await err(await callRoute(setup, "POST", "/api/auth/2fa/setup", { cookie: partial }))).code).toBe("invalid_state");
    expect((await err(await callRoute(enable, "POST", "/api/auth/2fa/enable", { cookie: partial, body: { code: totpAt(secret, now()) } }))).code).toBe("invalid_state");
  });
});

describe("sign-in code", () => {
  test("a valid code upgrades a partial session; the same code cannot be used twice", async () => {
    const { u, secret } = await enrolled();
    const partial = await partialFor(u.id);
    const code = totpAt(secret, now());
    const ok = await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/Max-Age=2592000$/);
    const replay = await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code } });
    expect((await err(replay)).code).toBe("totp_invalid");
  });

  test("a code from before the last used one is refused (the previous step after the current was used)", async () => {
    const { u, secret } = await enrolled();
    const partial = await partialFor(u.id);
    const older = totpAt(secret, now() - 30_000);
    expect((await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code: totpAt(secret, now()) } })).status).toBe(200);
    expect((await err(await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code: older } }))).code).toBe("totp_invalid");
  });

  test("five wrong codes lock the account for 10 minutes even against the right code", async () => {
    const { u, secret } = await enrolled("lock@test");
    const partial = await partialFor(u.id);
    for (let i = 0; i < 5; i++) {
      expect((await err(await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code: "111111" } }))).code).toBe("totp_invalid");
    }
    const locked = await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code: totpAt(secret, now()) } });
    expect(locked.status).toBe(429);
    expect((await err(locked)).message).toMatch(/Too many wrong codes/);
    deps.clock.advance(10 * 60_000 + 1);
    const after = await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code: totpAt(secret, now()) } });
    expect(after.status).toBe(200);
  });

  test("a user without 2FA cannot verify (mfa_required), and the body must be a code or a recovery code", async () => {
    const u = await makeUser("none@test");
    const partial = await partialFor(u.id);
    expect((await err(await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code: "123456" } }))).code).toBe("mfa_required");
    expect((await err(await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code: "12" } }))).code).toBe("invalid_input");
    expect((await callRoute(verify, "POST", "/api/auth/2fa/verify", { body: { code: "123456" } })).status).toBe(401);
  });
});

describe("recovery codes", () => {
  test("each code works once, case and dashes ignored, and reports how many are left", async () => {
    const { u, codes } = await enrolled();
    const partial = await partialFor(u.id);
    const r1 = await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { recovery_code: codes[0]!.toLowerCase().replace("-", "") } });
    expect(r1.status).toBe(200);
    expect((await r1.json()).recovery_codes_left).toBe(9);
    const again = await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { recovery_code: codes[0]! } });
    expect((await err(again)).code).toBe("totp_invalid");
    expect((await err(await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { recovery_code: "AAAAA-AAAAA" } }))).code).toBe("totp_invalid");
  });

  test("two concurrent uses of one code: exactly one succeeds", async () => {
    const { u, codes } = await enrolled();
    const partial = await partialFor(u.id);
    const results = await Promise.all([0, 1].map(() => callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { recovery_code: codes[1]! } })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  test("regenerating needs a fresh code (step-up) and voids the old codes", async () => {
    const { u, secret, codes, full } = await enrolled();
    expect((await err(await callRoute(regen, "POST", "/api/auth/2fa/recovery-codes", { cookie: full, body: { totp: "" } }))).code).toBe("totp_invalid");
    expect((await err(await callRoute(regen, "POST", "/api/auth/2fa/recovery-codes", { cookie: await partialFor(u.id), body: { totp: totpAt(secret, now()) } }))).code).toBe("mfa_required");
    const res = await callRoute(regen, "POST", "/api/auth/2fa/recovery-codes", { cookie: full, body: { totp: totpAt(secret, now()) } });
    expect(res.status).toBe(200);
    const fresh = (await res.json()).recovery_codes as string[];
    expect(fresh).toHaveLength(10);
    const old = await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: await partialFor(u.id), body: { recovery_code: codes[2]! } });
    expect((await err(old)).code).toBe("totp_invalid");
  });
});

describe("demo personas", () => {
  test("are enrolled with the published secret; the demo code signs them in; a second code in the same step waits", async () => {
    const res = await callRoute(demo, "POST", "/api/auth/demo", { body: { persona: "seller" } });
    const partial = cookieOf(res);
    const { code } = await (await callRoute(demoCode, "GET", "/api/auth/2fa/demo-code", { cookie: partial })).json();
    expect(code).toBe(totpAt(DEMO_TOTP_SECRETS.seller, now()));
    expect((await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code } })).status).toBe(200);
    const { code: next } = await (await callRoute(demoCode, "GET", "/api/auth/2fa/demo-code", { cookie: partial })).json();
    expect(next).toBe(totpAt(DEMO_TOTP_SECRETS.seller, now() + 30_000)); // the next step, still inside the drift window
    expect((await callRoute(verify, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code: next } })).status).toBe(200);
    const wait = await callRoute(demoCode, "GET", "/api/auth/2fa/demo-code", { cookie: partial });
    expect((await err(wait)).code).toBe("invalid_state");
  });

  test("no demo code for a real account or with DEMO_LOGIN off", async () => {
    const { u } = await enrolled("real@test");
    expect((await err(await callRoute(demoCode, "GET", "/api/auth/2fa/demo-code", { cookie: await partialFor(u.id) }))).code).toBe("invalid_state");
    const persona = cookieOf(await callRoute(demo, "POST", "/api/auth/demo", { body: { persona: "buyer" } }));
    vi.stubEnv("DEMO_LOGIN", "false");
    expect((await err(await callRoute(demoCode, "GET", "/api/auth/2fa/demo-code", { cookie: persona }))).code).toBe("invalid_input");
  });
});
