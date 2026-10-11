// T-16: every deal route through the real handler (06 "Zod schemas", "Access rules" 401 column, "One per command" route-level shapes,
// "Upload limits"); an unhandled exception answers 500 internal_error with no event; no `prisma` under app/api/deals/.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as deal from "@/lib/deal";
import { signFileUrl } from "@/lib/files/urls";
import { GET as list, POST as create } from "@/app/api/deals/route";
import { GET as read } from "@/app/api/deals/[code]/route";
import { PATCH as terms } from "@/app/api/deals/[code]/terms/route";
import { POST as joinRoute } from "@/app/api/deals/[code]/join/route";
import { POST as accept } from "@/app/api/deals/[code]/accept/route";
import { POST as payment } from "@/app/api/deals/[code]/payment/route";
import { POST as authorize } from "@/app/api/deals/[code]/payment/authorize/route";
import { POST as upload } from "@/app/api/deals/[code]/files/route";
import { POST as evidence } from "@/app/api/deals/[code]/evidence/route";
import { POST as review } from "@/app/api/deals/[code]/review/route";
import { POST as cancel } from "@/app/api/deals/[code]/cancel/route";
import { POST as retry } from "@/app/api/deals/[code]/payout/retry/route";
import { GET as eventsRoute } from "@/app/api/deals/[code]/events/route";
import { GET as pack } from "@/app/api/deals/[code]/evidence-pack/route";
import { GET as download } from "@/app/api/files/[id]/route";
import { callRoute, dealBuilder, enrollTotp, events, makeJpeg, parties, resetDb, signedAccept, signIn, testDeps, TRACKING, type Parties, type TestDeps } from "./helpers";
import { totpAt } from "@/lib/auth/totp";

const withoutType = <T extends { type: string }>({ type: _type, ...rest }: T) => (void _type, rest);
let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
let buyer: string; // cookies
let seller: string;
let third: string;

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
  [buyer, seller, third] = await Promise.all([signIn(p.buyer.id), signIn(p.seller.id), signIn(p.third.id)]);
});
afterEach(() => vi.restoreAllMocks());

type Opts = NonNullable<Parameters<typeof callRoute>[3]>;
/** callRoute with the handler's typed params loosened (Next 16 types each route's params as Promise<{ code }>). */
const api = (handler: unknown, method: string, path: string, opts: Opts = {}) =>
  Promise.resolve(callRoute(handler as Parameters<typeof callRoute>[0], method, path, opts));
const call = (handler: unknown, method: string, code: string, sub = "", opts: Opts = {}) =>
  api(handler, method, `/api/deals/${code}${sub}`, { ...opts, params: { code } });
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

const form = (purpose: string, bytes: Uint8Array | string, type = "image/jpeg") => {
  const fd = new FormData();
  fd.append("purpose", purpose);
  fd.append("file", new File([bytes as BlobPart], "photo", { type }));
  return fd;
};
const jpegOf = (size: number) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

describe("Zod schemas (06): invalid body -> 400 invalid_input before the deal is looked up", () => {
  const cases: [string, unknown, unknown][] = [
    ["POST /api/deals empty text", create, { text: "" }],
    ["POST /api/deals 501 chars", create, { text: "x".repeat(501) }],
    ["POST /api/deals missing text", create, {}],
    ["terms amount_minor 1000001", terms, { amount_minor: 1_000_001 }],
    ["terms amount_minor 0", terms, { amount_minor: 0 }],
    ["terms amount_minor 1.5", terms, { amount_minor: 1.5 }],
    ["terms deadline_days 0", terms, { deadline_days: 0 }],
    ["terms deadline_days 22", terms, { deadline_days: 22 }],
    ["terms item_title 81 chars", terms, { item_title: "x".repeat(81) }],
    ["terms evidence_type file", terms, { conditions: [{ text: "A", evidence_type: "file" }] }],
    ["terms no field", terms, { other: 1 }],
    ["accept terms_version 0", accept, { terms_version: 0 }],
    ["accept terms_version '1'", accept, { terms_version: "1" }],
    ["accept missing", accept, {}],
    ["authorize missing order_id", authorize, {}],
    ["authorize empty order_id", authorize, { order_id: " " }],
    ["evidence note 1001 chars", evidence, { file_ids: [], note: "x".repeat(1001) }],
    ["evidence file_ids missing", evidence, {}],
    ["evidence file_ids not strings", evidence, { file_ids: [1, 2] }],
    ["evidence tracking_number 65 chars", evidence, { file_ids: [], tracking_number: "x".repeat(65) }],
    ["review Approve", review, { decision: "Approve" }],
    ["review maybe", review, { decision: "maybe" }],
    ["not JSON", review, "not json"],
  ];
  test.each(cases)("%s", async (_label, handler, body) => {
    const method = handler === terms ? "PATCH" : "POST";
    const res = await call(handler, method, "HS-ZZZZ", "", { cookie: buyer, body });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_input");
  });

  test("valid rows: 500-char text -> 201; full terms body; authorize ORD-1; evidence with optional fields; review reject", async () => {
    const created = await call(create, "POST", "", "", { cookie: buyer, body: { text: "x".repeat(500) } });
    expect(created.status).toBe(201);
    const code = (await created.json()).code as string;
    const full = { item_title: "Jacket", amount_minor: 9000, deadline_days: 10, conditions: [{ text: "Tracking shows delivered", evidence_type: "tracking" }] };
    const edited = await call(terms, "PATCH", code, "/terms", { cookie: buyer, body: full });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ terms_version: 2, item_title: "Jacket", amount_minor: 9000, deadline_days: 10 });

    const held = await build.held();
    const ids = await build.evidence(held, 1);
    const sub = await call(evidence, "POST", held, "/evidence", { cookie: seller, body: { file_ids: ids, tracking_number: TRACKING, note: "Shipped." } });
    expect(sub.status).toBe(200);
    expect((await sub.json()).submissions[0]).toMatchObject({ note: "Shipped.", tracking_number: TRACKING });

    const rev = await build.inReview();
    const rejected = await call(review, "POST", rev, "/review", { cookie: buyer, body: { decision: "reject", note: "No." } });
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).status).toBe("voided");
    expect((await events(rev)).find((e) => e.cause === "review:reject")!.payload).toMatchObject({ note: "No." });
  });
});

describe("signed out -> 401 not_signed_in on every deal route (06 'Access rules')", () => {
  const routes: [string, unknown, string, string][] = [
    ["POST /api/deals", create, "POST", ""], ["GET /api/deals", list, "GET", ""], ["GET read", read, "GET", ""],
    ["PATCH terms", terms, "PATCH", "/terms"], ["join", joinRoute, "POST", "/join"], ["accept", accept, "POST", "/accept"],
    ["payment", payment, "POST", "/payment"], ["authorize", authorize, "POST", "/payment/authorize"], ["files", upload, "POST", "/files"],
    ["evidence", evidence, "POST", "/evidence"], ["review", review, "POST", "/review"], ["cancel", cancel, "POST", "/cancel"],
    ["payout/retry", retry, "POST", "/payout/retry"], ["events", eventsRoute, "GET", "/events"], ["evidence-pack", pack, "GET", "/evidence-pack"],
  ];
  test.each(routes)("%s", async (_label, handler, method, sub) => {
    const res = await call(handler, method, "HS-ZZZZ", sub, method === "GET" ? {} : { body: {} });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("not_signed_in");
  });
});

describe("one per command, through the routes", () => {
  test("create 201 with rejected[]; list; read as buyer and as a third user (preview)", async () => {
    const res = await call(create, "POST", "", "", { cookie: buyer, body: { text: "  I'll pay $80 for the jacket once it matches the photos  " } });
    expect(res.status).toBe(201);
    const v = await res.json();
    expect(v).toMatchObject({ role: "buyer", status: "draft", terms_version: 1, rejected: [], source_text: "I'll pay $80 for the jacket once it matches the photos" });
    expect(v.conditions).toHaveLength(3);

    const rows = await call(list, "GET", "", "", { cookie: buyer });
    expect(rows.status).toBe(200);
    expect((await rows.json()).map((r: { code: string }) => r.code)).toEqual([v.code]);
    expect(await (await call(list, "GET", "", "", { cookie: third })).json()).toEqual([]);

    expect((await (await call(read, "GET", v.code, "", { cookie: buyer })).json()).role).toBe("buyer");
    expect((await (await call(read, "GET", v.code, "", { cookie: third })).json()).role).toBe("preview");
    const missing = await call(read, "GET", "HS-ZZZZ", "", { cookie: buyer });
    expect(missing.status).toBe(404);
    expect(await errorCode(missing)).toBe("deal_not_found");
  });

  test("PATCH terms with one field keeps the others; seller -> 403", async () => {
    const code = await build.draft();
    const res = await call(terms, "PATCH", code, "/terms", { cookie: buyer, body: { amount_minor: 9000 } });
    expect(res.status).toBe(200);
    const v = await res.json();
    expect(v).toMatchObject({ terms_version: 2, amount_minor: 9000, item_title: "Hand-painted denim jacket", deadline_days: 7, buyer_accepted_version: null });
    expect(v.conditions).toHaveLength(3);
    expect((await events(code)).at(-1)!.payload).toEqual({ terms_version: 2, changed: ["amount_minor"] });
    await deal.handle(code, p.asSeller, { type: "join" }, deps);
    expect((await call(terms, "PATCH", code, "/terms", { cookie: seller, body: { amount_minor: 1 } })).status).toBe(403);
  });

  test("join, accept (seller then buyer), payment { order_id }, authorize -> held", async () => {
    const code = await build.draft();
    const joined = await call(joinRoute, "POST", code, "/join", { cookie: seller });
    expect(joined.status).toBe(200);
    expect((await joined.json()).role).toBe("seller");

    // trust spec §6: the body is the signed accept plus a fresh authenticator code
    const [sSecret, bSecret] = [await enrollTotp(p.seller.id), await enrollTotp(p.buyer.id)];
    const body = async (who: typeof p.asSeller, secret: string) => {
      const signed = withoutType(await signedAccept(code, who, 1));
      return { ...signed, totp: totpAt(secret, deps.clock.now().getTime()) };
    };
    const s = await call(accept, "POST", code, "/accept", { cookie: seller, body: await body(p.asSeller, sSecret) });
    expect(await s.json()).toMatchObject({ status: "draft", seller_accepted_version: 1 });
    const b = await call(accept, "POST", code, "/accept", { cookie: buyer, body: await body(p.asBuyer, bSecret) });
    expect(await b.json()).toMatchObject({ status: "terms_agreed", buyer_accepted_version: 1 });
    expect((await call(read, "GET", code, "", { cookie: buyer }).then((r) => r.json())).contract.signatures).toHaveLength(2);

    const pay = await call(payment, "POST", code, "/payment", { cookie: buyer });
    expect(pay.status).toBe(200);
    expect(await pay.json()).toEqual({ order_id: "ORD-1" });

    const auth = await call(authorize, "POST", code, "/payment/authorize", { cookie: buyer, body: { order_id: "ORD-1" } });
    expect(auth.status).toBe(200);
    expect(await auth.json()).toMatchObject({ status: "held", payment: { status: "authorized", authorization_id: "AUTH-1" } });
  });

  test("evidence -> captured; events as id strings ascending; evidence-pack as an attachment", async () => {
    const code = await build.held();
    const ids = await build.evidence(code, 2);
    const res = await call(evidence, "POST", code, "/evidence", { cookie: seller, body: { file_ids: ids, tracking_number: TRACKING } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "captured", submissions: [{ submission_no: 1, decision: "capture", note: null }] });

    const ev = await call(eventsRoute, "GET", code, "/events", { cookie: buyer });
    expect(ev.status).toBe(200);
    const rows = (await ev.json()) as { id: string; cause: string }[];
    expect(rows.map((r) => r.cause).slice(-4)).toEqual(["submit_evidence", "verdict", "decision:capture", "fact:capture_completed"]);
    expect(rows.every((r) => typeof r.id === "string" && /^\d+$/.test(r.id))).toBe(true);
    expect(rows.map((r) => BigInt(r.id))).toEqual([...rows.map((r) => BigInt(r.id))].sort((a, b) => (a < b ? -1 : 1)));

    const pk = await call(pack, "GET", code, "/evidence-pack", { cookie: seller });
    expect(pk.status).toBe(200);
    expect(pk.headers.get("content-disposition")).toBe(`attachment; filename="handshake-${code}-evidence-pack.json"`);
    expect(pk.headers.get("content-type")).toContain("application/json");
    expect(await pk.json()).toMatchObject({ format: "handshake-evidence-pack/1", generated_for: "seller", deal: { code } });
    expect((await call(pack, "GET", code, "/evidence-pack", { cookie: third })).status).toBe(403);
  });

  test("review approve with no note stores note: null; cancel; payout/retry", async () => {
    const code = await build.inReview();
    const res = await call(review, "POST", code, "/review", { cookie: buyer, body: { decision: "approve" } });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("captured");
    const approve = (await events(code)).find((e) => e.cause === "review:approve")!;
    expect(approve.payload).toMatchObject({ note: null });

    const draft = await build.draft();
    const cancelled = await call(cancel, "POST", draft, "/cancel", { cookie: buyer });
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).status).toBe("voided");

    await deps.db.payout.updateMany({ where: { deal: { public_code: code } }, data: { status: "failed", failure_reason: "FAILED" } });
    const retried = await call(retry, "POST", code, "/payout/retry", { cookie: seller });
    expect(retried.status).toBe(200);
    expect((await retried.json()).payouts.map((x: { attempt: number; status: string }) => [x.attempt, x.status])).toEqual([[1, "failed"], [2, "pending"]]);
    expect((await call(retry, "POST", code, "/payout/retry", { cookie: buyer })).status).toBe(403);
  });
});

describe("upload limits (06)", () => {
  test("2,097,152 bytes -> 201 FileRef; 2,097,153 -> 413; text as image/jpeg -> 400; gif -> 400; 5th reference -> 422", async () => {
    const code = await build.draft();
    const ok = await call(upload, "POST", code, "/files", { cookie: buyer, body: form("reference", jpegOf(2_097_152)) });
    expect(ok.status).toBe(201);
    const ref = await ok.json();
    expect(ref).toMatchObject({ purpose: "reference", mime: "image/jpeg", size_bytes: 2_097_152 });
    expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ref.url).toMatch(new RegExp(`^/api/files/${ref.id}\\?exp=\\d+&sig=[A-Za-z0-9_-]+$`));

    const big = await call(upload, "POST", code, "/files", { cookie: buyer, body: form("reference", jpegOf(2_097_153)) });
    expect(big.status).toBe(413);
    expect(await errorCode(big)).toBe("file_too_large");

    const text = await call(upload, "POST", code, "/files", { cookie: buyer, body: form("reference", "hello, not a jpeg") });
    expect(text.status).toBe(400);
    const gif = await call(upload, "POST", code, "/files", { cookie: buyer, body: form("reference", new TextEncoder().encode("GIF89a\x01\x00"), "image/gif") });
    expect(gif.status).toBe(400);
    const badPurpose = await call(upload, "POST", code, "/files", { cookie: buyer, body: form("other", makeJpeg(1)) });
    expect(badPurpose.status).toBe(400);

    for (let i = 2; i <= 4; i++) expect((await call(upload, "POST", code, "/files", { cookie: buyer, body: form("reference", makeJpeg(i)) })).status).toBe(201);
    const fifth = await call(upload, "POST", code, "/files", { cookie: buyer, body: form("reference", makeJpeg(5)) });
    expect(fifth.status).toBe(422);
    expect(await errorCode(fifth)).toBe("too_many_files");
    expect(await deps.db.file.count()).toBe(4);
  });

  test("Content-Length over 2,621,440 -> 413 before the body is read", async () => {
    const code = await build.draft();
    const req = new Request(`http://localhost/api/deals/${code}/files`, {
      method: "POST", body: "tiny", headers: { cookie: buyer, "content-type": "multipart/form-data; boundary=x", "content-length": "2621441" },
    });
    const spy = vi.spyOn(req, "formData");
    const res = await upload(req, { params: Promise.resolve({ code }) });
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe("file_too_large");
    expect(spy).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
  });

  test("bytes round-trip through GET /api/files/{id}; expired, tampered, malformed and unknown links", async () => {
    const code = await build.draft();
    const bytes = makeJpeg(7);
    const ref = await (await call(upload, "POST", code, "/files", { cookie: buyer, body: form("reference", bytes) })).json();
    const url = new URL(`http://localhost${ref.url}`);
    const get = (u: URL, id = ref.id as string) => api(download, "GET", u.pathname + u.search, { params: { id } });

    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    expect(res.headers.get("content-length")).toBe("64");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

    const tampered = new URL(url);
    const sig = tampered.searchParams.get("sig")!;
    tampered.searchParams.set("sig", sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A"));
    expect((await get(tampered)).status).toBe(403);
    expect(await errorCode(await get(tampered))).toBe("not_a_party");

    const malformed = new URL(url);
    malformed.searchParams.set("exp", "soon");
    expect((await get(malformed)).status).toBe(400);
    const noSig = new URL(url);
    noSig.searchParams.delete("sig");
    expect((await get(noSig)).status).toBe(400);

    const unknownId = randomUUID();
    const unknown = await api(download, "GET", signFileUrl(unknownId, 600, deps.clock.now()), { params: { id: unknownId } });
    expect(unknown.status).toBe(404);
    expect(await errorCode(unknown)).toBe("deal_not_found");
    const notUuid = await api(download, "GET", signFileUrl("nope", 600, deps.clock.now()), { params: { id: "nope" } });
    expect(notUuid.status).toBe(404);

    deps.clock.advance(601_000);
    const expired = await get(url);
    expect(expired.status).toBe(403);
    expect(await errorCode(expired)).toBe("not_a_party");
  });
});

test("a plain Error from the module -> 500 internal_error with no deal_events row added", async () => {
  const code = await build.draft();
  const before = (await events(code)).length;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(deal, "handle").mockRejectedValueOnce(new Error("boom"));
  const res = await call(cancel, "POST", code, "/cancel", { cookie: buyer });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: { code: "internal_error", message: "Something went wrong. Try again." } });
  expect((await events(code)).length).toBe(before);
  expect((await deps.db.deal.findUniqueOrThrow({ where: { public_code: code } })).status).toBe("draft");
});

test("no file under app/api/deals/ mentions prisma (B4)", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const files = walk(join(__dirname, "../../app/api/deals"));
  expect(files.length).toBe(14);
  for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/prisma/i);
});
