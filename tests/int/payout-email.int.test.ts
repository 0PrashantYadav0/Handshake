// trust spec §8: the payout address needs step-up to change and an emailed code to verify; nobody is paid at an unverified one.
import { beforeEach, describe, expect, test } from "vitest";
import { PATCH as patchMe } from "@/app/api/me/route";
import { POST as verifyRoute } from "@/app/api/me/paypal-email/verify/route";
import { POST as resendRoute } from "@/app/api/me/paypal-email/resend/route";
import { handle } from "@/lib/deal";
import { payoutBatchId } from "@/lib/deal/keys";
import { totpAt } from "@/lib/auth/totp";
import { callRoute, dealBuilder, enrollTotp, expectError, makeUser, parties, resetDb, signIn, testDeps, type TestDeps } from "./helpers";

let deps: TestDeps;
beforeEach(async () => {
  await resetDb();
  deps = testDeps();
});

const err = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;
const lastCode = (to: string) => {
  const m = [...deps.email.sent].reverse().find((e) => e.to === to);
  return /code is (\d{6})/.exec(m?.text ?? "")?.[1] ?? "";
};

async function seller(email = "s@test") {
  const u = await makeUser(email);
  const secret = await enrollTotp(u.id);
  const cookie = await signIn(u.id);
  const code = () => {
    const c = totpAt(secret, deps.clock.now().getTime());
    deps.clock.advance(30_000);
    return c;
  };
  const patch = (body: Record<string, unknown>) => callRoute(patchMe, "PATCH", "/api/me", { cookie, body });
  const verify = (c: string) => callRoute(verifyRoute, "POST", "/api/me/paypal-email/verify", { cookie, body: { code: c } });
  return { u, cookie, code, patch, verify };
}

describe("setting the payout email", () => {
  test("needs a fresh code; stores it unverified and emails a 6-digit code to the new address", async () => {
    const s = await seller();
    expect((await err(await s.patch({ paypal_email: "PP@Test" }))).code).toBe("totp_invalid");
    expect((await err(await s.patch({ paypal_email: "pp@test", totp: "000000" }))).code).toBe("totp_invalid");
    const ok = await s.patch({ paypal_email: "PP@Test", totp: s.code() });
    expect(ok.status).toBe(200);
    expect((await ok.json()).user).toMatchObject({ paypal_email: "pp@test", paypal_email_verified: false });
    expect(deps.email.sent.at(-1)).toMatchObject({ to: "pp@test", subject: "Confirm your Handshake payout email" });
    const row = await deps.db.user.findUniqueOrThrow({ where: { id: s.u.id } });
    expect(row.paypal_email_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.paypal_email_code_hash).not.toContain(lastCode("pp@test"));
  });

  test("a replayed step-up code is refused", async () => {
    const s = await seller();
    const code = s.code();
    deps.clock.advance(-30_000); // still inside the same step window for the replay
    expect((await s.patch({ paypal_email: "a@test", totp: code })).status).toBe(200);
    expect((await err(await s.patch({ paypal_email: "b@test", totp: code }))).code).toBe("totp_invalid");
  });

  test("the right code verifies; wrong codes count; five wrong lock the code; expiry; the same verified address again is a no-op", async () => {
    const s = await seller();
    await s.patch({ paypal_email: "pp@test", totp: s.code() });
    const good = lastCode("pp@test");
    const wrong = good === "000000" ? "111111" : "000000";
    expect((await err(await s.verify(wrong))).message).toMatch(/wrong/);
    expect((await s.verify(good)).status).toBe(200);
    const me = await deps.db.user.findUniqueOrThrow({ where: { id: s.u.id } });
    expect(me.paypal_email_verified_at).not.toBeNull();
    expect(me.paypal_email_code_hash).toBeNull();
    const sent = deps.email.sent.length;
    expect((await s.patch({ paypal_email: "pp@test" })).status).toBe(200); // no step-up, no new code
    expect(deps.email.sent).toHaveLength(sent);

    await s.patch({ paypal_email: "new@test", totp: s.code() });
    const fresh = lastCode("new@test");
    for (let i = 0; i < 5; i++) await s.verify(fresh === "000000" ? "111111" : "000000");
    expect((await err(await s.verify(fresh))).message).toMatch(/Too many/);

    await callRoute(resendRoute, "POST", "/api/me/paypal-email/resend", { cookie: s.cookie });
    deps.clock.advance(15 * 60_000);
    expect((await err(await s.verify(lastCode("new@test")))).message).toMatch(/expired/);
  });

  test("changing the address makes it unverified and voids the old code", async () => {
    const s = await seller();
    await s.patch({ paypal_email: "one@test", totp: s.code() });
    const oldCode = lastCode("one@test");
    await s.patch({ paypal_email: "two@test", totp: s.code() });
    const res = await s.verify(oldCode);
    expect(res.status).toBe(400);
    expect((await deps.db.user.findUniqueOrThrow({ where: { id: s.u.id } })).paypal_email_verified_at).toBeNull();
  });

  test("resend: only for an unverified address, three per 10 minutes", async () => {
    const s = await seller();
    const resend = () => callRoute(resendRoute, "POST", "/api/me/paypal-email/resend", { cookie: s.cookie });
    expect((await err(await resend())).code).toBe("paypal_email_required");
    await s.patch({ paypal_email: "pp@test", totp: s.code() });
    for (let i = 0; i < 3; i++) expect((await resend()).status).toBe(200);
    expect((await resend()).status).toBe(429);
    await s.verify(lastCode("pp@test"));
    deps.clock.advance(11 * 60_000);
    expect((await err(await resend())).code).toBe("invalid_state");
  });
});

describe("money only goes to a verified address", () => {
  test("seller accept and the buyer's agreeing accept need a verified seller address", async () => {
    const p = await parties();
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email_verified_at: null } });
    const b = dealBuilder(deps, p);
    const code = await b.joined();
    await expectError(handle(code, p.asSeller, { type: "accept", terms_version: 1 }, deps), "payout_email_unverified");
    await handle(code, p.asBuyer, { type: "accept", terms_version: 1 }, deps);
    expect((await deps.db.deal.findUniqueOrThrow({ where: { public_code: code } })).status).toBe("draft");
  });

  test("an address changed after agreeing: the payout is recorded failed, PayPal is not called, and retry pays the verified address", async () => {
    const p = await parties();
    const b = dealBuilder(deps, p);
    const code = await b.held();
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: "changed@test", paypal_email_verified_at: null } });
    deps.ai.judgeWith([]);
    await b.submit(code);
    const rows = await deps.db.payout.findMany({ where: { deal: { public_code: code } } });
    expect(rows).toMatchObject([{ attempt: 1, status: "failed", failure_reason: "PAYOUT_EMAIL_UNVERIFIED", paypal_batch_id: null }]);
    expect(deps.paypal.calls.filter((c) => c.op === "createPayout")).toHaveLength(0);

    await expectError(handle(code, p.asSeller, { type: "retry_payout" }, deps), "payout_email_unverified");
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email_verified_at: new Date() } });
    await handle(code, p.asSeller, { type: "retry_payout" }, deps);
    const sent = deps.paypal.calls.filter((c) => c.op === "createPayout");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ requestId: payoutBatchId(code, 2), args: { receiver: "changed@test" } });
  });
});
