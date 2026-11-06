// The fixes from the review of the agent layer: each test fails without its fix, except "a failure after the evidence is committed",
// which keeps the orphan cleanup from going too far.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as magicLink } from "@/app/api/auth/magic-link/route";
import { POST as authCallback } from "@/app/api/auth/callback/route";
import { POST as revokeKey } from "@/app/api/agents/keys/[id]/revoke/route";
import { POST as makeKey } from "@/app/api/agents/keys/route";
import { POST as upload } from "@/app/api/deals/[code]/files/route";
import { POST as mcp } from "@/app/api/mcp/route";
import { POST as webhook } from "@/app/api/webhooks/paypal/route";
import { negotiate } from "@/lib/agents/desk";
import { issueAgentKey } from "@/lib/agents/keys";
import { samplePhotos } from "@/lib/agents/samples";
import { callTool, type ToolContext } from "@/lib/agents/tools";
import { DEFAULT_EXTRACT } from "@/lib/ai/fake";
import { totpAt } from "@/lib/auth/totp";
import { prisma } from "@/lib/db";
import { handle, tick } from "@/lib/deal";
import { assertEventsInC6, callRoute, dealBuilder, enrollTotp, expectError, makeJpeg, parties, resetDb, signIn, testDeps, TRACKING, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
let buyer: ToolContext;
let seller: ToolContext;
let sellerToken: string;
const prevDemo = process.env.DEMO_LOGIN;
beforeAll(() => void (process.env.DEMO_LOGIN = "true"));
afterAll(() => void (process.env.DEMO_LOGIN = prevDemo));

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
  const b = await issueAgentKey(p.buyer.id, { label: "Buyer bot", max_amount_minor: 10_000 }, prisma);
  const s = await issueAgentKey(p.seller.id, { label: "Seller bot", max_amount_minor: 10_000 }, prisma);
  buyer = { key: b.key, deps, baseUrl: "https://x.test" };
  seller = { key: s.key, deps, baseUrl: "https://x.test" };
  sellerToken = s.token;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await assertEventsInC6();
});

type Brief = { code: string; status: string; latest_decision: string | null; next_step: string };
const run = (name: string, args: unknown, c: ToolContext) => callTool(name, args, c) as Promise<Brief>;
const photo = (seed: number) => {
  const b = new Uint8Array(128);
  b.set(makeJpeg(seed));
  return Buffer.from(b).toString("base64");
};
const NOT_A_PHOTO = Buffer.alloc(128).toString("base64");
const evidenceFiles = () => prisma.file.count({ where: { purpose: "evidence" } });
const referenceFiles = () => prisma.file.count({ where: { purpose: "reference" } });

describe("submit_proof stores nothing it can't use", () => {
  test("a missing tracking number is refused before any upload, so the retry isn't locked out", async () => {
    const code = await build.held();
    const six = [1, 2, 3, 4, 5, 6].map(photo);
    await expectError(run("submit_proof", { code, photos: six }, seller), "invalid_input");
    expect(await evidenceFiles()).toBe(0);
    const r = await run("submit_proof", { code, photos: six, tracking_number: TRACKING }, seller);
    expect(r.latest_decision).toBe("capture");
  });

  test("one bad photo, or an empty note or tracking number, stores none of the photos", async () => {
    const code = await build.held();
    await expectError(run("submit_proof", { code, photos: [photo(1), photo(2), NOT_A_PHOTO], tracking_number: TRACKING }, seller), "invalid_input");
    await expectError(run("submit_proof", { code, photos: [photo(1)], tracking_number: "" }, seller), "invalid_input");
    await expectError(run("submit_proof", { code, photos: [photo(1)], tracking_number: TRACKING, note: "" }, seller), "invalid_input");
    expect(await evidenceFiles()).toBe(0);
  });

  test("a call that fails partway removes its own uploads and no one else's", async () => {
    const code = await build.held();
    await build.evidence(code, 4);
    await expectError(run("submit_proof", { code, photos: [photo(1), photo(2), photo(3)], tracking_number: TRACKING }, seller), "too_many_files");
    expect(await evidenceFiles()).toBe(4);
  });

  test("a failure after the evidence is committed keeps the files its rows use", async () => {
    const code = await build.held();
    deps.paypal.failNext("captureAuthorization", { status: 500, name: "INTERNAL_SERVER_ERROR" });
    await expectError(run("submit_proof", { code, photos: [photo(1), photo(2)], tracking_number: TRACKING }, seller), "paypal_error");
    expect(await evidenceFiles()).toBe(2);
  });

  test("a sample name off Object.prototype gets the list of sets, not a crash", async () => {
    for (const name of ["constructor", "__proto__", "toString"]) await expectError(samplePhotos("the blue ceramic mug", "HS-7KQ2", name), "invalid_input");
  });
});

describe("add_listing_photos stores all of its photos or none", () => {
  test("one bad photo stores none, and a call past the limit of 4 stores none", async () => {
    const { code } = await run("propose_deal", { sentence: "I'll pay $18 for a mug" }, buyer);
    await expectError(run("add_listing_photos", { code, photos: [photo(1), photo(2), NOT_A_PHOTO] }, buyer), "invalid_input");
    expect(await referenceFiles()).toBe(0);
    await run("add_listing_photos", { code, photos: [photo(1), photo(2), photo(3)] }, buyer);
    await expectError(run("add_listing_photos", { code, photos: [photo(4), photo(5)] }, buyer), "too_many_files");
    expect(await referenceFiles()).toBe(3);
  });
});

describe("cancel", () => {
  test("a hold placed after cancel read the deal is not stranded: the first cancel refuses, the second voids it", async () => {
    const code = await build.agreed();
    const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    const real = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (...a: unknown[]) => {
      await handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps);
      return real(...a);
    }) as never);
    await expectError(handle(code, p.asSeller, { type: "cancel" }, deps), "invalid_state");
    expect((await prisma.deal.findFirstOrThrow({ select: { status: true } })).status).toBe("held");
    expect((await handle(code, p.asSeller, { type: "cancel" }, deps)).status).toBe("voided");
    expect(deps.paypal.calls.filter((c) => c.op === "voidAuthorization")).toHaveLength(1);
  });
});

describe("negotiate", () => {
  test("the seller's final offer gets an answer", async () => {
    let turns = 0;
    deps.ai.negotiateWith((i) => (i.role === "seller"
      ? { say: "Hmm", offer_minor: ++turns === 4 ? 1900 : 2300, accept: false }
      : { say: "Fine", offer_minor: 1500, accept: i.history.at(-1)!.offer_minor <= 2000 }));
    expect(await negotiate("honest", deps, () => {})).toBe(1900);
  });
});

describe("next_step", () => {
  test("a sentence with no price says a person must set it, before and after the seller joins", async () => {
    deps.ai.extractWith({ ...DEFAULT_EXTRACT, amount_minor: null });
    const { code, next_step } = await run("propose_deal", { sentence: "I'll pay for the mug if it matches" }, buyer);
    expect(next_step).toContain("price or deadline is missing");
    expect((await run("join_deal", { code }, seller)).next_step).toContain("price or deadline is missing");
  });

  test("a failed payout says a person must retry it", async () => {
    const code = await build.captured();
    expect((await run("get_deal", { code }, seller)).next_step).toContain("PayPal is paying");
    await prisma.payout.updateMany({ data: { status: "failed", failure_reason: "UNCLAIMED" } });
    expect((await run("get_deal", { code }, seller)).next_step).toContain("retry");
  });

  test("a seeded deal says no action is possible, and list_deals marks it and reports the total", async () => {
    const codes: string[] = [];
    for (let i = 0; i < 51; i++) codes.push(await build.draft());
    await prisma.deal.update({ where: { public_code: codes[50]! }, data: { seeded: true } });
    expect((await run("get_deal", { code: codes[50]! }, buyer)).next_step).toContain("Historical demo deal");
    const list = (await callTool("list_deals", {}, buyer)) as { deals: { code: string; seeded: boolean }[]; total: number };
    expect(list.total).toBe(51);
    expect(list.deals).toHaveLength(50);
    expect(list.deals.find((d) => d.code === codes[50])?.seeded).toBe(true);
  });
});

describe("the limits on a user's agents", () => {
  test("propose_deal shares the 20 extractions per user, across keys", async () => {
    const second = await issueAgentKey(p.buyer.id, { label: "Second", max_amount_minor: 10_000 }, prisma);
    for (let i = 0; i < 20; i++) await run("propose_deal", { sentence: "I'll pay $18 for a mug" }, buyer);
    await expectError(run("propose_deal", { sentence: "I'll pay $18 for a mug" }, { ...buyer, key: second.key }), "rate_limited");
    expect(deps.ai.calls.filter((c) => c.job === "extract")).toHaveLength(20);
  });

  test("a second key does not get a fresh MCP bucket", async () => {
    const second = await issueAgentKey(p.seller.id, { label: "Second", max_amount_minor: 10_000 }, prisma);
    const ping = (token: string) => callRoute(mcp as never, "POST", "/api/mcp", { body: { jsonrpc: "2.0", id: 1, method: "ping" }, headers: { authorization: `Bearer ${token}` } });
    for (let i = 0; i < 120; i++) expect((await ping(sellerToken)).status).toBe(200);
    expect((await ping(second.token)).status).toBe(429);
  });

  test("a third large MCP call at once is told to wait, a small one isn't, and the slots come back", async () => {
    const third = await issueAgentKey(p.third.id, { label: "Third", max_amount_minor: 10_000 }, prisma);
    const authorization = `Bearer ${third.token}`;
    const PING = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
    const open: ReadableStreamDefaultController<Uint8Array>[] = [];
    const calls = [1, 2].map(() => mcp(new Request("http://x/api/mcp", {
      method: "POST", headers: { authorization }, duplex: "half",
      body: new ReadableStream<Uint8Array>({ start: (c) => void open.push(c) }),
    } as RequestInit)));
    const undeclared = () => callRoute(mcp as never, "POST", "/api/mcp", { body: PING, headers: { authorization } }); // a Request sets no Content-Length by itself
    const declared = (bytes: number) => callRoute(mcp as never, "POST", "/api/mcp", { body: PING, headers: { authorization, "content-length": String(bytes) } });
    await vi.waitFor(async () => expect((await undeclared()).status).toBe(503));
    expect((await declared(5 * 1024 * 1024)).status).toBe(503);
    expect((await declared(PING.length)).status).toBe(200);
    for (const c of open) {
      c.enqueue(new TextEncoder().encode(PING));
      c.close();
    }
    for (const res of await Promise.all(calls)) expect(res.status).toBe(200);
    expect((await undeclared()).status).toBe(200);
  });
});

describe("a chunked body has no Content-Length, and is still capped", () => {
  /** A request with a streamed body of `total` bytes, pad first and tail last, recording how much of it was read. */
  const streamed = (path: string, total: number, headers: Record<string, string> = {}, tail = "") => {
    const CHUNK = new Uint8Array(64 * 1024).fill(0x20);
    const seen = { bytes: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (seen.bytes >= total) {
          if (tail) c.enqueue(new TextEncoder().encode(tail));
          return c.close();
        }
        seen.bytes += CHUNK.length;
        c.enqueue(CHUNK);
      },
      cancel: () => void (seen.cancelled = true),
    });
    return { seen, req: new Request(`http://localhost${path}`, { method: "POST", headers, body, duplex: "half" } as RequestInit) };
  };
  const MB = 1024 * 1024;
  const expectStopped = (seen: { bytes: number; cancelled: boolean }, cap: number) => {
    expect(seen.cancelled).toBe(true);
    expect(seen.bytes).toBeLessThan(cap + MB);
  };

  test("/api/mcp: 413 past 17 MB, and six full-size photos' worth still parses", async () => {
    const authorization = `Bearer ${sellerToken}`;
    const big = streamed("/api/mcp", 30 * MB, { authorization });
    expect((await mcp(big.req)).status).toBe(413);
    expectStopped(big.seen, 17 * MB);
    const fits = streamed("/api/mcp", 16 * MB, { authorization }, '{"jsonrpc":"2.0","id":7,"method":"ping"}');
    const res = await mcp(fits.req);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 7, result: {} });
  }, 30_000);

  test("the webhook: 400 past 64 KB, before verifying or storing anything", async () => {
    const big = streamed("/api/webhooks/paypal", MB);
    const res = await webhook(big.req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Body too large.");
    expectStopped(big.seen, 64 * 1024);
    expect(deps.paypal.calls.filter((c) => c.op === "verifyWebhook")).toEqual([]);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  test("parseBody, with no sign-in: 400 past 256 KB", async () => {
    const big = streamed("/api/auth/magic-link", 5 * MB, { "content-type": "application/json" });
    const res = await magicLink(big.req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("Body too large.");
    expectStopped(big.seen, 256 * 1024);
  });

  test("the upload route: file_too_large past 2.5 MB, and a normal multipart body still arrives", async () => {
    const code = await build.held();
    const cookie = await signIn(p.seller.id);
    const big = streamed(`/api/deals/${code}/files`, 20 * MB, { cookie, "content-type": "multipart/form-data; boundary=x" });
    const res = await upload(big.req, { params: Promise.resolve({ code }) });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("file_too_large");
    expectStopped(big.seen, 2.5 * MB);
    const form = new FormData();
    form.set("purpose", "evidence");
    form.set("file", new Blob([Buffer.from(makeJpeg(9))], { type: "image/jpeg" }), "a.jpg");
    expect((await callRoute(upload as never, "POST", `/api/deals/${code}/files`, { body: form, cookie, params: { code } })).status).toBe(201);
  });

  test("the sign-in callback: an oversized form is just a bad link", async () => {
    const big = streamed("/api/auth/callback", 5 * MB, { "content-type": "application/x-www-form-urlencoded" });
    const res = await authCallback(big.req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/signin?error=invalid_link");
    expectStopped(big.seen, 256 * 1024);
  });
});

describe("unverified webhooks can't fill the disk", () => {
  const post = (id: string) => {
    deps.paypal.failNext("verifyWebhook", "timeout");
    return callRoute(webhook as never, "POST", "/api/webhooks/paypal", { body: JSON.stringify({ id, event_type: "x", resource: {} }) });
  };

  test("past the bucket the answer is the same 400 and nothing more is stored; verified events still are", async () => {
    for (let i = 0; i < 20; i++) expect((await post(`BAD-${i}`)).status).toBe(400);
    expect(await prisma.webhookEvent.count()).toBe(20);
    const over = await post("BAD-OVER");
    expect(over.status).toBe(400);
    expect((await over.json()).error.message).toBe("Signature verification failed.");
    expect(await prisma.webhookEvent.count()).toBe(20);
    const good = await callRoute(webhook as never, "POST", "/api/webhooks/paypal", { body: JSON.stringify({ id: "GOOD", event_type: "x", resource: {} }) });
    expect(good.status).toBe(200);
    expect(await prisma.webhookEvent.count({ where: { verified: true } })).toBe(1);
  });

  test("the tick deletes unverified rows older than 7 days and nothing else", async () => {
    const now = deps.clock.now();
    const old = new Date(now.getTime() - 8 * 86_400_000);
    const row = (paypal_event_id: string, verified: boolean, created_at: Date) => ({ paypal_event_id, event_type: "x", verified, body: {}, created_at });
    await prisma.webhookEvent.createMany({ data: [row("OLD-BAD", false, old), row("NEW-BAD", false, now), row("OLD-GOOD", true, old)] });
    await tick(now, deps);
    expect((await prisma.webhookEvent.findMany({ select: { paypal_event_id: true }, orderBy: { paypal_event_id: "asc" } })).map((r) => r.paypal_event_id)).toEqual(["NEW-BAD", "OLD-GOOD"]);
  });
});

describe("agent keys", () => {
  const post = (cookie: string, label: string, totp: string) => callRoute(makeKey as never, "POST", "/api/agents/keys", { cookie, body: { label, max_usd: 25, totp } });

  test("the desk's two names are refused; any other name starting with Desk is an ordinary key", async () => {
    const secret = await enrollTotp(p.third.id);
    const cookie = await signIn(p.third.id);
    const code = totpAt(secret, deps.clock.now().getTime());
    expect((await post(cookie, "Desk buying agent", code)).status).toBe(400);
    expect((await post(cookie, " Desk selling agent ", code)).status).toBe(400);
    expect(await prisma.agentKey.count({ where: { user_id: p.third.id } })).toBe(0);
    expect((await post(cookie, "Desk lamp buyer", code)).status).toBe(201);
  });

  test("revoking a malformed id is a 400, not a 500", async () => {
    const res = await callRoute(revokeKey as never, "POST", "/api/agents/keys/not-a-uuid/revoke", { cookie: await signIn(p.buyer.id), params: { id: "not-a-uuid" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_input");
  });
});
