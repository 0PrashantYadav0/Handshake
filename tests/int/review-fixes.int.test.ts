// The fixes from the independent review of the trust work (issue #67): one test per finding, each failing without its fix.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as acceptRoute } from "@/app/api/deals/[code]/accept/route";
import { POST as revokeRoute } from "@/app/api/keys/[id]/revoke/route";
import { POST as regenRoute } from "@/app/api/auth/2fa/recovery-codes/route";
import { POST as demoRoute } from "@/app/api/auth/demo/route";
import { GET as demoCodeRoute } from "@/app/api/auth/2fa/demo-code/route";
import { POST as verifyRoute } from "@/app/api/auth/2fa/verify/route";
import { POST as everywhereRoute } from "@/app/api/auth/sign-out-everywhere/route";
import { GET as meRoute, PATCH as patchMe } from "@/app/api/me/route";
import { POST as payoutVerifyRoute } from "@/app/api/me/paypal-email/verify/route";
import { addFile, applyPaypalEvent, getDeal, handle, tick } from "@/lib/deal";
import { checkTotp } from "@/lib/auth/mfa";
import { totpAt } from "@/lib/auth/totp";
import { APPROVED_HOLD_MS } from "@/lib/deal/reconcile";
import { openDealRow } from "@/lib/deal/sealed";
import { DEAL_INCLUDE } from "@/lib/deal/access";
import { prisma } from "@/lib/db";
import { DEFAULT_EXTRACT } from "@/lib/ai/fake";
import { reseal } from "../../scripts/reseal";
import type { DealView } from "@/lib/deal/types";
import {
  callRoute, dealBuilder, enrollTotp, events, expectError, makeJpeg, parties, resetDb, signedAccept, signIn, testDeps, webhookEvent,
  type Parties, type TestDeps,
} from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
  vi.stubEnv("DEMO_LOGIN", "true");
  vi.stubEnv("DEMO_SELLER_PAYPAL_EMAIL", "demo-seller-pp@test");
});
afterEach(() => vi.unstubAllEnvs());

const ops = (op: string) => deps.paypal.calls.filter((c) => c.op === op);
const errOf = async (res: Response) => ((await res.json()) as { error: { code: string; message: string } }).error;
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const now = () => deps.clock.now().getTime();

describe("finding 1: the TOTP failure limit holds under parallel guesses and lives in the database", () => {
  test("20 parallel wrong codes: at most 5 are checked, then even the right code waits", async () => {
    const secret = await enrollTotp(p.buyer.id);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => checkTotp(p.buyer.id, "000001", deps.db, deps.clock.now())));
    const codes = results.map((r) => (r.status === "rejected" ? (r.reason as { code: string }).code : "ok"));
    expect(codes.filter((c) => c === "totp_invalid").length).toBeLessThanOrEqual(5);
    expect(codes.filter((c) => c === "rate_limited").length).toBeGreaterThanOrEqual(15);
    await expectError(checkTotp(p.buyer.id, totpAt(secret, now()), deps.db, deps.clock.now()), "rate_limited");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p.buyer.id } })).totp_failures).toBeGreaterThan(5);
    deps.clock.advance(10 * 60_000 + 1);
    await checkTotp(p.buyer.id, totpAt(secret, now()), deps.db, deps.clock.now());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p.buyer.id } })).totp_failures).toBe(0);
  });
});

describe("finding 5: the shared demo accounts", () => {
  async function demoSeller() {
    const partial = cookieOf(await callRoute(demoRoute, "POST", "/api/auth/demo", { body: { persona: "seller" } }));
    const { code } = await (await callRoute(demoCodeRoute, "GET", "/api/auth/2fa/demo-code", { cookie: partial })).json();
    const full = cookieOf(await callRoute(verifyRoute, "POST", "/api/auth/2fa/verify", { cookie: partial, body: { code } }));
    deps.clock.advance(30_000);
    const fresh = async () => (await (await callRoute(demoCodeRoute, "GET", "/api/auth/2fa/demo-code", { cookie: full })).json()).code as string;
    return { full, fresh, id: (await prisma.user.findUniqueOrThrow({ where: { email: "demo-seller@handshake.demo" } })).id };
  }

  test("payout address, key revocation and recovery codes are locked even with the published code", async () => {
    const s = await demoSeller();
    expect((await errOf(await callRoute(patchMe, "PATCH", "/api/me", { cookie: s.full, body: { paypal_email: "thief@test", totp: await s.fresh() } }))).code).toBe("invalid_state");
    deps.clock.advance(30_000);
    expect((await errOf(await callRoute(regenRoute, "POST", "/api/auth/2fa/recovery-codes", { cookie: s.full, body: { totp: await s.fresh() } }))).code).toBe("invalid_state");
    const key = await prisma.signingKey.create({ data: { user_id: s.id, fingerprint: "f".repeat(64), x: "A".repeat(43), y: "B".repeat(43) } });
    deps.clock.advance(30_000);
    const r = await callRoute(revokeRoute as never, "POST", `/api/keys/${key.id}/revoke`, { cookie: s.full, body: { totp: await s.fresh() }, params: { id: key.id } });
    expect((await errOf(r)).code).toBe("invalid_state");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).paypal_email).toBe("demo-seller-pp@test");
  });

  test("a visitor cannot lock the demo account out with wrong codes", async () => {
    const s = await demoSeller();
    for (let i = 0; i < 8; i++) await expectError(checkTotp(s.id, "000001", deps.db, deps.clock.now()), "totp_invalid");
    await checkTotp(s.id, await s.fresh(), deps.db, deps.clock.now());
  });
});

describe("finding 3: a refused void never becomes a fresh capture", () => {
  test("AUTHORIZATION_EXPIRED on cancel: the deal is voided, nothing captured", async () => {
    const code = await build.held();
    deps.paypal.failNext("voidAuthorization", { status: 422, name: "AUTHORIZATION_EXPIRED" });
    const v = await handle(code, p.asBuyer, { type: "cancel" }, deps);
    expect(v.status).toBe("voided");
    expect(ops("captureAuthorization")).toHaveLength(0);
  });

  test("any other 422 is an error: the deal stays held, nothing captured", async () => {
    const code = await build.held();
    deps.paypal.failNext("voidAuthorization", { status: 422, name: "UNPROCESSABLE_ENTITY" });
    await expectError(handle(code, p.asBuyer, { type: "cancel" }, deps), "paypal_error");
    expect(ops("captureAuthorization")).toHaveLength(0);
    expect((await prisma.deal.findUniqueOrThrow({ where: { public_code: code } })).status).toBe("held");
  });
});

describe("finding 4: holds placed off the API path pass the contract gate", () => {
  test("CHECKOUT.ORDER.APPROVED for a tampered contract: no authorization, the refusal is recorded", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await prisma.deal.update({ where: { public_code: code }, data: { amount_minor: 1 } });
    const out = await applyPaypalEvent(webhookEvent("CHECKOUT.ORDER.APPROVED", { id: "ORD-1", status: "APPROVED", purchase_units: [{ custom_id: code }] }), deps);
    expect(out).toEqual({ outcome: "noop" });
    expect(ops("authorizeOrder")).toHaveLength(0);
    expect((await events(code)).filter((e) => e.cause === "contract:verification_failed")).toHaveLength(1);
  });

  test("reconcile finds a CREATED hold on a tampered contract: it voids the hold instead of recording it", async () => {
    const code = await build.agreed();
    const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    deps.paypal.authorizeStatus = "PENDING";
    await expectError(handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps), "paypal_error");
    const auth = (await prisma.payment.findFirstOrThrow({ where: { deal: { public_code: code } } })).authorization_id!;
    deps.paypal.authorizations.get(auth)!.status = "CREATED";
    await prisma.payment.updateMany({ where: { deal: { public_code: code } }, data: { updated_at: deps.clock.now() } });
    await prisma.deal.update({ where: { public_code: code }, data: { amount_minor: 1 } });
    deps.clock.advance(APPROVED_HOLD_MS + 1000);
    await tick(deps.clock.now(), deps);
    expect(ops("voidAuthorization").map((c) => c.args)).toEqual([expect.objectContaining({ authorization_id: auth })]);
    expect((await prisma.deal.findUniqueOrThrow({ where: { public_code: code } })).status).toBe("voided");
  });
});

describe("finding 6: listing photos and the rule are part of the signed contract", () => {
  test("the contract carries the photo hashes and the rule snapshot; no photo can be added after anyone signs", async () => {
    const code = await build.joined();
    await addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: makeJpeg(7) }, deps);
    const v = (await getDeal(code, p.asBuyer, deps)) as DealView;
    expect(v.contract!.document.reference_photos).toEqual([{ position: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(v.contract!.document.rule).toEqual({ pass_threshold: expect.any(Number), auto_capture_max_minor: expect.any(Number) });
    await handle(code, p.asBuyer, await signedAccept(code, p.asBuyer), deps);
    await expectError(addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: makeJpeg(8) }, deps), "invalid_state");
  });
});

describe("finding 7: payout email codes cannot be guessed in parallel past the limit", () => {
  test("10 parallel wrong codes spend 5 attempts; the right code is then refused", async () => {
    const secret = await enrollTotp(p.third.id);
    const cookie = await signIn(p.third.id);
    await callRoute(patchMe, "PATCH", "/api/me", { cookie, body: { paypal_email: "new@test", totp: totpAt(secret, now()) } });
    const right = /code is (\d{6})/.exec(deps.email.sent.at(-1)!.text)![1]!;
    const wrong = right === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 10 }, () => callRoute(payoutVerifyRoute, "POST", "/api/me/paypal-email/verify", { cookie, body: { code: wrong } })));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p.third.id } })).paypal_email_code_attempts).toBe(5);
    expect((await errOf(await callRoute(payoutVerifyRoute, "POST", "/api/me/paypal-email/verify", { cookie, body: { code: right } }))).message).toMatch(/Too many/);
  });
});

describe("finding 8 and finding 2: event fragments are sealed; legacy plaintext can be sealed by reseal", () => {
  test("the create event's rejected list is sealed in the database", async () => {
    deps.ai.extractWith({ ...DEFAULT_EXTRACT, rejected: [{ text: "secret fragment", suggestion: "x" }] });
    const code = await build.draft();
    const raw = await prisma.$queryRaw<{ payload: unknown }[]>`SELECT payload FROM deal_events e JOIN deals d ON d.id = e.deal_id WHERE d.public_code = ${code} AND e.cause = 'create'`;
    expect(typeof (raw[0]!.payload as { rejected: unknown }).rejected).toBe("string");
  });

  test("plaintext event payloads written before encryption are sealed with --seal-plaintext-events", async () => {
    const code = await build.draft();
    const d = await prisma.deal.findUniqueOrThrow({ where: { public_code: code } });
    await prisma.dealEvent.create({ data: { deal_id: d.id, from_status: "draft", to_status: "draft", actor: "buyer", cause: "edit_terms", payload: { note: "legacy plaintext", rejected: [{ text: "old" }] } } });
    await expect(getDeal(code, p.asBuyer, deps)).rejects.toThrow();
    const r = await reseal(prisma, { sealPlaintextEvents: true });
    expect(r.events_sealed).toBe(1);
    const opened = openDealRow(await prisma.deal.findUniqueOrThrow({ where: { id: d.id }, include: DEAL_INCLUDE }));
    expect(opened.events.at(-1)!.payload).toMatchObject({ note: "legacy plaintext", rejected: [{ text: "old" }] });
    await expect(prisma.$executeRawUnsafe(`DELETE FROM deal_events WHERE deal_id = '${d.id}'`)).rejects.toThrow(/append-only/); // trigger back on
  });
});

describe("notes: sessions can be ended everywhere; a stale accept keeps the step-up code", () => {
  test("sign out everywhere ends every older session", async () => {
    const a = await signIn(p.buyer.id);
    expect((await callRoute(meRoute, "GET", "/api/me", { cookie: a })).status).toBe(200);
    expect((await callRoute(everywhereRoute, "POST", "/api/auth/sign-out-everywhere", { cookie: a })).status).toBe(200);
    expect((await errOf(await callRoute(meRoute, "GET", "/api/me", { cookie: a }))).code).toBe("not_signed_in");
  });

  test("a wrong contract hash is refused before the code is spent; the same code then signs", async () => {
    const code = await build.joined();
    const secret = await enrollTotp(p.seller.id);
    const cookie = await signIn(p.seller.id);
    const { type: _type, ...signed } = await signedAccept(code, p.asSeller);
    void _type;
    const totp = totpAt(secret, now());
    const call = (body: unknown) => callRoute(acceptRoute as never, "POST", `/api/deals/${code}/accept`, { cookie, body, params: { code } });
    expect((await errOf(await call({ ...signed, contract_hash: "e".repeat(64), totp }))).code).toBe("signature_invalid");
    expect((await call({ ...signed, totp })).status).toBe(200);
  });
});
