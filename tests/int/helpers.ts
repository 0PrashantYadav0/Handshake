// Integration harness (06 "Harness"): real Postgres, fakes for everything else.
import { prisma } from "@/lib/db";
import { fixedClock, type FixedClock } from "@/lib/clock";
import { overrideDeps } from "@/lib/deps";
import { fakeAi, type FakeAi } from "@/lib/ai/fake";
import { fakeEmail, type RecordingEmail } from "@/lib/email/console";
import { fakePaypal, type FakePaypal } from "@/lib/paypal/fake";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { newTotpSecret } from "@/lib/auth/totp";
import { aad, seal } from "@/lib/crypto/seal";
import { signingMessage } from "@/lib/contract/canonical";
import { bytesToB64url, type PublicKey } from "@/lib/contract/signature";
import { DEAL_INCLUDE } from "@/lib/deal/access";
import { contractDocOf, hashOf } from "@/lib/deal/contract";
import { addFile, createDeal, DealError, handle } from "@/lib/deal";
import type { JudgeMode } from "@/lib/ai/fake";
import { openDealRow, openPayload } from "@/lib/deal/sealed";
import type { Actor, Command, DealView, EventActor, PaypalWebhookEvent } from "@/lib/deal/types";
import { expect } from "vitest";

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.FILE_URL_SECRET ??= "test-file-url-secret-at-least-32-characters-long";

export const CLOCK_START = "2026-10-20T10:00:00Z";

export type TestDeps = { db: typeof prisma; paypal: FakePaypal; ai: FakeAi; email: RecordingEmail; clock: FixedClock };

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "used_login_tokens", "webhook_events", "contract_signatures", "signing_keys", "deal_events", "payouts", "payments", "verdicts",
      "evidence", "files", "conditions", "deals", "users" RESTART IDENTITY CASCADE`,
  );
}

let deps: TestDeps | undefined;

/** Builds fresh fakes, installs them with overrideDeps, and returns them for assertions. */
export function testDeps(overrides: Partial<TestDeps> = {}): TestDeps {
  const clock = overrides.clock ?? fixedClock(CLOCK_START);
  deps = { db: prisma, paypal: fakePaypal(clock), ai: fakeAi(), email: fakeEmail(), clock, ...overrides };
  overrideDeps(deps);
  return deps;
}

/** A paypal_email is verified unless verified: false (trust spec §8). */
export function makeUser(email: string, opts: { display_name?: string; paypal_email?: string; verified?: boolean } = {}) {
  const verified = opts.paypal_email && opts.verified !== false ? new Date() : null;
  return prisma.user.create({ data: { email, display_name: opts.display_name ?? null, paypal_email: opts.paypal_email ?? null, paypal_email_verified_at: verified } });
}

// ---------- trust spec §6: each test user signs with its own P-256 key, like a browser would ----------
const testKeys = new Map<string, CryptoKeyPair>();
export async function testKeyFor(userId: string): Promise<CryptoKeyPair> {
  let k = testKeys.get(userId);
  if (!k) testKeys.set(userId, (k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])));
  return k;
}
export async function signHash(pair: CryptoKeyPair, hash: string): Promise<{ signature: string; public_key: PublicKey }> {
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(signingMessage(hash)));
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { signature: bytesToB64url(sig), public_key: { x: jwk.x!, y: jwk.y! } };
}
/** The accept command a party's browser would send: its key's signature over the deal's current contract hash. */
export async function signedAccept(code: string, actor: Actor, terms_version = 1): Promise<Extract<Command, { type: "accept" }>> {
  const row = await prisma.deal.findUnique({ where: { public_code: code }, include: DEAL_INCLUDE });
  const doc = row ? contractDocOf(openDealRow(row)) : null;
  const contract_hash = doc ? hashOf(doc) : "0".repeat(64); // nothing to sign yet: the command fails before the signature check
  return { type: "accept", terms_version, contract_hash, ...(await signHash(await testKeyFor(actor.user_id), contract_hash)) };
}

/** Turns 2FA on with a fresh secret (trust spec §4); returns the secret for totpAt(). */
export async function enrollTotp(userId: string): Promise<string> {
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { totp_secret: seal(secret, aad("users.totp_secret", userId)), totp_enabled_at: new Date(), totp_last_step: null } });
  return secret;
}

export async function signIn(userId: string): Promise<string> {
  return `${SESSION_COOKIE}=${await signSession(userId, true)}`;
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

export function callRoute(
  handler: Handler,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; params?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<Response> | Response {
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    body = typeof opts.body === "string" || opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body);
    if (typeof body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  }
  return handler(new Request(`http://localhost${path}`, { method, headers, body }), { params: Promise.resolve(opts.params ?? {}) });
}

export function webhookEvent(type: string, resource: Record<string, unknown>): PaypalWebhookEvent {
  if (!deps) throw new Error("call testDeps() first");
  return deps.paypal.event(type, resource);
}

// ---------- parties and deal builders (06 "Harness") ----------

export const DEFAULT_TEXT = "I'll pay $80 for the hand-painted denim jacket once it arrives within a week and matches the photos";

export async function parties() {
  const buyer = await makeUser("buyer@test", { display_name: "Buyer" });
  const seller = await makeUser("seller@test", { display_name: "Seller", paypal_email: "seller-pp@test" });
  const third = await makeUser("third@test");
  const as = (u: { id: string }): Actor => ({ user_id: u.id });
  return { buyer, seller, third, asBuyer: as(buyer), asSeller: as(seller), asThird: as(third) };
}
export type Parties = Awaited<ReturnType<typeof parties>>;

/** A distinct, valid-looking JPEG (FF D8 FF header) per seed; 64 bytes. */
export function makeJpeg(seed: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < b.length; i++) b[i] = (seed * 31 + i * 7) & 0xff;
  b[b.length - 1] = seed & 0xff;
  return b;
}

export const TRACKING = "TRK-DEMO-0000"; // last digit even: delivered (D7)

/** Drives a deal through the real commands; each step returns the public code. */
export function dealBuilder(deps: TestDeps, p: Parties) {
  const b = {
    /** n evidence photos uploaded by the seller (held); returns their file ids in upload order. */
    async evidence(code: string, n = 2, seedFrom = 100): Promise<string[]> {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) ids.push((await addFile(code, p.asSeller, { purpose: "evidence", mime: "image/jpeg", bytes: makeJpeg(seedFrom + i) }, deps)).id);
      return ids;
    },
    /** submit_evidence on a held deal with fresh photos and TRK-DEMO-0000; the verdict and the decision run inside (B5). */
    async submit(code: string, extra: { note?: string | null; tracking_number?: string | null; files?: number } = {}): Promise<DealView> {
      const file_ids = await b.evidence(code, extra.files ?? 2, 100 + 10 * (await deps.db.evidence.count({ where: { deal: { public_code: code } } })));
      return handle(code, p.asSeller, { type: "submit_evidence", file_ids, tracking_number: extra.tracking_number === undefined ? TRACKING : extra.tracking_number, note: extra.note ?? null }, deps);
    },
    /** held, then submit_evidence judged with `set` (default: all pass); the status is wherever decide() sent it. */
    async proofSubmitted(set: JudgeMode = []): Promise<string> {
      const code = await b.held();
      deps.ai.judgeWith(set);
      await b.submit(code);
      return code;
    },
    /** in_review: c1 unclear 0.40 (SB-4). */
    inReview: (): Promise<string> => b.proofSubmitted([{ result: "unclear", confidence: 0.4, reason: "Blurry." }]),
    /** captured with CAP-1, payout attempt 1 sent (SB-1 to captured). */
    captured: (): Promise<string> => b.proofSubmitted(),
    async draft(text = DEFAULT_TEXT): Promise<string> {
      return (await createDeal(p.asBuyer, { text }, deps)).code;
    },
    async joined(): Promise<string> {
      const code = await b.draft();
      await handle(code, p.asSeller, { type: "join" }, deps);
      return code;
    },
    async agreed(): Promise<string> {
      const code = await b.joined();
      await handle(code, p.asSeller, await signedAccept(code, p.asSeller, 1), deps);
      await handle(code, p.asBuyer, await signedAccept(code, p.asBuyer, 1), deps);
      return code;
    },
    async held(): Promise<string> {
      const code = await b.agreed();
      const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
      await handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps);
      return code;
    },
  };
  return b;
}

/** Raw rows, opened (trust spec §5) so assertions read plain values. */
export const events = async (code: string) =>
  (await prisma.dealEvent.findMany({ where: { deal: { public_code: code } }, orderBy: { id: "asc" } })).map((e) => ({ ...e, payload: openPayload(e.deal_id, e.payload) }));
export const dealRow = async (code: string) =>
  openDealRow(await prisma.deal.findUniqueOrThrow({ where: { public_code: code }, include: { payment: true, payouts: true, conditions: { orderBy: { position: "asc" } } } }));

/** Asserts the promise rejects with a DealError of the given code; returns it for message checks. */
export function expectError(promise: Promise<unknown>, code: string): Promise<DealError> {
  return promise.then(
    () => { throw new Error(`expected DealError ${code}`); },
    (e: unknown) => {
      expect(e).toBeInstanceOf(DealError);
      expect((e as DealError).code).toBe(code);
      return e as DealError;
    },
  );
}

/** Decisions C6: cause -> allowed actors. */
export const C6: Record<string, EventActor[]> = {
  create: ["buyer"], edit_terms: ["buyer"], join: ["seller"], accept: ["buyer", "seller"], start_payment: ["buyer"],
  submit_evidence: ["seller"], verdict: ["ai"],
  "decision:capture": ["system"], "decision:request_fix": ["system"], "decision:buyer_review": ["system"], "decision:void": ["system"],
  "review:approve": ["buyer"], "review:reject": ["buyer"], cancel: ["buyer", "seller"], retry_payout: ["seller"],
  "tick:deadline": ["system"], "tick:reverify": ["system"],
  "fact:authorization_created": ["paypal"], "fact:late_authorization_voided": ["paypal"], "fact:capture_completed": ["paypal"],
  "fact:capture_pending": ["paypal"], "fact:capture_declined": ["paypal"], "fact:authorization_voided": ["paypal"],
  "fact:payout_succeeded": ["paypal"], "fact:payout_failed": ["paypal"],
  "contract:verification_failed": ["system"], // trust spec §7
};

/** afterEach: every cause written by the test is a C6 string with a C6 actor, and the per-deal chain is unbroken (06 "Audit log"). */
export async function assertEventsInC6(): Promise<void> {
  const rows = await prisma.dealEvent.findMany({ orderBy: { id: "asc" } });
  const prev = new Map<string, string>();
  for (const r of rows) {
    expect(C6[r.cause], `unknown cause ${r.cause}`).toContain(r.actor);
    expect(r.from_status, `chain broken at event ${r.id} (${r.cause})`).toBe(prev.get(r.deal_id) ?? null);
    prev.set(r.deal_id, r.to_status);
  }
}
