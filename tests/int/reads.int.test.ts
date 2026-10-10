// 06 "One per command" read / list / events / evidence pack rows, "Access rules" (F4, H2) and the module half of "Upload limits".
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { addFile, createDeal, getDeal, getEvents, getEvidencePack, handle, listDeals } from "@/lib/deal";
import { toIso } from "@/lib/deal/dates";
import type { DealView } from "@/lib/deal/types";
import { MAX_FILE_BYTES } from "@/lib/files/validate";
import { verifyFileUrl } from "@/lib/files/urls";
import { assertEventsInC6, dealBuilder, events, expectError, parties, resetDb, testDeps, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});
afterEach(assertEventsInC6);

const bytesOf = (magic: number[], size: number) => {
  const b = new Uint8Array(size);
  b.set(magic.slice(0, size));
  return b;
};
const jpeg = (size = 100, salt = 0) => { const b = bytesOf([0xff, 0xd8, 0xff], size); b[size - 1] = salt; return b; };
const png = (size = 100) => bytesOf([0x89, 0x50, 0x4e, 0x47], size);
const webp = (size = 100) => bytesOf([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")], size);
const urlOk = (url: string) => {
  const u = new URL(url, "http://localhost");
  return verifyFileUrl(u.pathname.split("/").at(-1)!, u.searchParams.get("exp"), u.searchParams.get("sig"), deps.clock.now());
};

describe("read", () => {
  test("the DealView for buyer and seller: files with signed URLs, payment, role-aware seller.paypal_email", async () => {
    const draft = await build.draft();
    await addFile(draft, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: jpeg() }, deps);
    await handle(draft, p.asSeller, { type: "join" }, deps);
    await handle(draft, p.asSeller, { type: "accept", terms_version: 1 }, deps);
    await handle(draft, p.asBuyer, { type: "accept", terms_version: 1 }, deps);
    const v0 = await handle(draft, p.asBuyer, { type: "start_payment" }, deps);
    await handle(draft, p.asBuyer, { type: "confirm_approval", order_id: v0.payment!.paypal_order_id }, deps);

    const asBuyer = (await getDeal(draft, p.asBuyer, deps)) as DealView;
    expect(asBuyer).toMatchObject({
      role: "buyer", status: "held", currency: "USD", seeded: false, submissions: [], payouts: [],
      buyer: { display_name: "Buyer", email: "buyer@test" },
      seller: { display_name: "Seller", email: "seller@test", has_paypal_email: true, paypal_email: null },
      payment: { status: "authorized", paypal_order_id: "ORD-1", authorization_id: "AUTH-1" },
    });
    expect(asBuyer.reference_files).toHaveLength(1);
    expect(asBuyer.reference_files[0]).toMatchObject({ purpose: "reference", mime: "image/jpeg", size_bytes: 100 });
    expect(urlOk(asBuyer.reference_files[0]!.url)).toBe(true);
    expect(asBuyer.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

    const asSeller = (await getDeal(draft, p.asSeller, deps)) as DealView;
    expect(asSeller.role).toBe("seller");
    expect(asSeller.seller!.paypal_email).toBe("seller-pp@test");
    expect(asSeller.reference_files[0]!.sha256).toBe(asBuyer.reference_files[0]!.sha256);
  });
  test("a seeded deal has payment null even with a payments row", async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await deps.db.deal.update({ where: { public_code: code }, data: { seeded: true } });
    expect(((await getDeal(code, p.asBuyer, deps)) as DealView).payment).toBeNull();
  });
});

describe("list", () => {
  test("only the caller's deals, newest last event first, with counterparty and last_event_cause", async () => {
    const a = await build.joined();
    const b = await build.draft();
    await createDeal(p.asThird, { text: "third's own deal for $10" }, deps);
    const buyerRows = await listDeals(p.asBuyer, deps);
    expect(buyerRows.map((r) => r.code)).toEqual([b, a]);
    expect(buyerRows[1]).toMatchObject({ role: "buyer", counterparty: "Seller", last_event_cause: "join", status: "draft", amount_minor: 8000, seeded: false, lowest_confidence: null });
    expect(buyerRows[0]!.counterparty).toBeNull();
    const sellerRows = await listDeals(p.asSeller, deps);
    expect(sellerRows.map((r) => [r.code, r.role, r.counterparty])).toEqual([[a, "seller", "Buyer"]]);
    expect(await listDeals({ user_id: p.third.id }, deps)).toHaveLength(1);
  });
});

describe("events", () => {
  test("ascending ids as strings with every field", async () => {
    const code = await build.held();
    const ev = await getEvents(code, p.asBuyer, deps);
    expect(ev.map((e) => e.cause)).toEqual(["create", "join", "accept", "accept", "start_payment", "fact:authorization_created"]);
    for (const e of ev) {
      expect(typeof e.id).toBe("string");
      expect(e.id).toMatch(/^\d+$/);
      expect(Object.keys(e).sort()).toEqual(["actor", "cause", "created_at", "from_status", "id", "payload", "to_status"]);
    }
    expect(ev.map((e) => BigInt(e.id))).toEqual([...ev.map((e) => BigInt(e.id))].sort((x, y) => (x < y ? -1 : 1)));
    await expectError(getEvents(code, p.asThird, deps), "not_a_party");
  });
});

describe("evidence pack", () => {
  test("every key of 04 section 10.2, no top-level evidence or verdicts, seller-only paypal_email", async () => {
    const code = await build.draft();
    await addFile(code, p.asBuyer, { purpose: "reference", mime: "image/png", bytes: png() }, deps);
    await handle(code, p.asSeller, { type: "join" }, deps);
    await handle(code, p.asSeller, { type: "accept", terms_version: 1 }, deps);
    await handle(code, p.asBuyer, { type: "accept", terms_version: 1 }, deps);
    const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps);

    const pack = await getEvidencePack(code, p.asSeller, deps);
    expect(Object.keys(pack).sort()).toEqual(["conditions", "deal", "events", "extraction", "format", "generated_at", "generated_for", "parties", "payment", "payouts", "reference_files", "submissions", "webhook_events"].sort());
    expect(pack).toMatchObject({
      format: "handshake-evidence-pack/1", generated_at: toIso(deps.clock.now()), generated_for: "seller",
      deal: { code, status: "held", terms_version: 1, seeded: false },
      parties: { buyer: { display_name: "Buyer", email: "buyer@test" }, seller: { display_name: "Seller", email: "seller@test", paypal_email: "seller-pp@test" } },
      payment: { paypal_order_id: "ORD-1", authorization_id: "AUTH-1", capture_id: null },
      payouts: [], submissions: [], webhook_events: [],
      extraction: { model: "fake", prompt_version: "extract-v1", rejected: [] },
    });
    expect(Object.keys(pack.deal).sort()).toEqual(["amount_minor", "buyer_accepted_version", "code", "created_at", "currency", "deadline_at", "deadline_days", "fix_attempts_used", "item_title", "seeded", "seller_accepted_version", "source_text", "status", "terms_version", "updated_at"]);
    expect(pack.conditions).toHaveLength(3);
    expect(pack.reference_files[0]).toMatchObject({ mime: "image/png", size_bytes: 100, sha256: createHash("sha256").update(png()).digest("hex") });
    expect(urlOk(pack.reference_files[0]!.url)).toBe(true);
    expect(pack.events.map((e) => e.cause)).toEqual(["create", "join", "accept", "accept", "start_payment", "fact:authorization_created"]);
    expect(typeof pack.events[0]!.id).toBe("string");

    const forBuyer = await getEvidencePack(code, p.asBuyer, deps);
    expect(forBuyer.generated_for).toBe("buyer");
    expect(forBuyer.parties.seller!.paypal_email).toBeNull();
    await expectError(getEvidencePack(code, p.asThird, deps), "not_a_party");
  });
});

describe("access rules (F4, H2)", () => {
  test("preview: exactly the F4 keys for a third user on a joinable draft; 403 once a seller exists", async () => {
    const code = await build.draft();
    const preview = await getDeal(code, p.asThird, deps);
    expect(Object.keys(preview).sort()).toEqual(["amount_minor", "buyer", "code", "conditions", "currency", "deadline_days", "item_title", "role"]);
    expect(preview).toMatchObject({ role: "preview", code, item_title: "Hand-painted denim jacket", amount_minor: 8000, currency: "USD", deadline_days: 7, buyer: { display_name: "Buyer" } });
    expect(Object.keys((preview as { buyer: object }).buyer)).toEqual(["display_name"]);
    expect((preview as { conditions: unknown[] }).conditions).toHaveLength(3);

    await handle(code, p.asSeller, { type: "join" }, deps);
    await expectError(getDeal(code, p.asThird, deps), "not_a_party");
    const voided = await build.draft();
    await handle(voided, p.asBuyer, { type: "cancel" }, deps);
    await expectError(getDeal(voided, p.asThird, deps), "not_a_party"); // not draft: no preview
  });
  test("a preview reader may only join; every other command is 403", async () => {
    const code = await build.draft();
    await expectError(handle(code, p.asThird, { type: "accept", terms_version: 1 }, deps), "not_a_party");
    await expectError(handle(code, p.asThird, { type: "cancel" }, deps), "not_a_party");
    await expectError(getEvents(code, p.asThird, deps), "not_a_party");
    await expectError(getEvidencePack(code, p.asThird, deps), "not_a_party");
    await expectError(addFile(code, p.asThird, { purpose: "reference", mime: "image/jpeg", bytes: jpeg() }, deps), "not_a_party");
  });
  test("wrong party: buyer-only and seller-only commands and uploads", async () => {
    const code = await build.agreed();
    await expectError(handle(code, p.asSeller, { type: "start_payment" }, deps), "not_a_party");
    await expectError(handle(code, p.asSeller, { type: "confirm_approval", order_id: "ORD-1" }, deps), "not_a_party");
    await expectError(addFile(code, p.asBuyer, { purpose: "evidence", mime: "image/jpeg", bytes: jpeg() }, deps), "not_a_party");
    await expectError(addFile(code, p.asSeller, { purpose: "reference", mime: "image/jpeg", bytes: jpeg() }, deps), "not_a_party");
  });
  test("unknown code -> deal_not_found everywhere", async () => {
    await expectError(getDeal("HS-ZZZZ", p.asBuyer, deps), "deal_not_found");
    await expectError(handle("HS-ZZZZ", p.asBuyer, { type: "join" }, deps), "deal_not_found");
    await expectError(handle("HS-ZZZZ", p.asBuyer, { type: "cancel" }, deps), "deal_not_found");
    await expectError(getEvents("HS-ZZZZ", p.asBuyer, deps), "deal_not_found");
    await expectError(getEvidencePack("HS-ZZZZ", p.asBuyer, deps), "deal_not_found");
    await expectError(addFile("HS-ZZZZ", p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: jpeg() }, deps), "deal_not_found");
  });
});

describe("addFile", () => {
  test("reference: FileRef with sniffed mime, sha256 and size stored, no event; the 5th is too_many_files", async () => {
    const code = await build.draft();
    const n = (await events(code)).length;
    const ref = await addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: webp() }, deps);
    expect(ref).toMatchObject({ purpose: "reference", mime: "image/webp", size_bytes: 100, sha256: createHash("sha256").update(webp()).digest("hex") });
    expect(Object.keys(ref).sort()).toEqual(["created_at", "id", "mime", "purpose", "sha256", "size_bytes", "url"]);
    expect(urlOk(ref.url)).toBe(true);
    const row = await deps.db.file.findUniqueOrThrow({ where: { id: ref.id }, omit: { bytes: false } });
    expect(row).toMatchObject({ mime: "image/webp", size_bytes: 100, sha256: ref.sha256, uploaded_by: p.buyer.id });
    expect(Buffer.from(row.bytes).equals(Buffer.from(webp()))).toBe(true);
    expect(await events(code)).toHaveLength(n);

    for (let i = 1; i <= 3; i++) await addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: jpeg(100, i) }, deps);
    await expectError(addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: jpeg(100, 9) }, deps), "too_many_files");
    expect(await deps.db.file.count()).toBe(4);
  });
  test("size and type limits", async () => {
    const code = await build.draft();
    const big = await addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: jpeg(MAX_FILE_BYTES) }, deps);
    expect(big.size_bytes).toBe(MAX_FILE_BYTES);
    await expectError(addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: jpeg(MAX_FILE_BYTES + 1) }, deps), "file_too_large");
    await expectError(addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: new Uint8Array(0) }, deps), "file_too_large");
    await expectError(addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: Buffer.from("hello, not an image") }, deps), "invalid_input");
    await expectError(addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: bytesOf([0x47, 0x49, 0x46, 0x38], 100) }, deps), "invalid_input"); // GIF
  });
  test("reference only in draft before the seller accepted; evidence only in held before the deadline; 7th evidence -> too_many_files", async () => {
    const code = await build.joined();
    await handle(code, p.asSeller, { type: "accept", terms_version: 1 }, deps);
    const e = await expectError(addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: jpeg() }, deps), "invalid_state");
    expect(e.message).toBe("Edit the terms before adding photos.");
    await handle(code, p.asBuyer, { type: "accept", terms_version: 1 }, deps);
    await expectError(addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: jpeg() }, deps), "invalid_state");
    await expectError(addFile(code, p.asSeller, { purpose: "evidence", mime: "image/jpeg", bytes: jpeg() }, deps), "invalid_state");

    const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps);
    for (let i = 1; i <= 6; i++) {
      const f = await addFile(code, p.asSeller, { purpose: "evidence", mime: "image/jpeg", bytes: jpeg(100, i) }, deps);
      expect(f.purpose).toBe("evidence");
    }
    await expectError(addFile(code, p.asSeller, { purpose: "evidence", mime: "image/jpeg", bytes: jpeg(100, 7) }, deps), "too_many_files");

    deps.clock.advance(7 * 24 * 3600_000); // now == deadline_at
    const late = await expectError(addFile(code, p.asSeller, { purpose: "evidence", mime: "image/jpeg", bytes: jpeg(100, 8) }, deps), "invalid_state");
    expect(late.message).toBe("The deadline has passed");
    expect(await events(code)).toHaveLength(6);
  });
});
