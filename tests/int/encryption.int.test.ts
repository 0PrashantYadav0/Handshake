// TR-2 (trust spec §5): contract data is sealed in every row, the app reads plain values, a value moved to another deal fails
// to open, and npm run reseal moves every mutable column to the active key.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { GET as read } from "@/app/api/deals/[code]/route";
import { GET as download } from "@/app/api/files/[id]/route";
import { keyring, SealError } from "@/lib/crypto/seal";
import { addFile, getDeal, getEvents, getEvidencePack, handle, listDeals, type DealView } from "@/lib/deal";
import { EVENT_SEALED_KEYS } from "@/lib/deal/sealed";
import { reseal } from "../../scripts/reseal";
import { callRoute, dealBuilder, DEFAULT_TEXT, makeJpeg, parties, resetDb, signIn, testDeps, TRACKING, type Parties, type TestDeps } from "./helpers";

const NOTE = "Shipped Monday in the original box";
const REASON = "The jacket in e1 matches the listing photo r1.";
const REF = makeJpeg(7);
const KEYS = process.env.DATA_KEYS!;

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});
afterEach(() => {
  process.env.DATA_KEYS = KEYS;
});

/** A captured deal with a reference photo, two evidence photos, a tracking number, a note and three verdicts. */
async function fullDeal(): Promise<{ code: string; id: string; view: DealView }> {
  const code = await build.joined();
  await addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: REF }, deps);
  await handle(code, p.asSeller, { type: "accept", terms_version: 1 }, deps);
  await handle(code, p.asBuyer, { type: "accept", terms_version: 1 }, deps);
  const v = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
  await handle(code, p.asBuyer, { type: "confirm_approval", order_id: v.payment!.paypal_order_id }, deps);
  deps.ai.judgeWith([{ result: "pass", confidence: 0.95, reason: REASON }]);
  await build.submit(code, { note: NOTE });
  const view = (await getDeal(code, p.asBuyer, deps)) as DealView;
  const [{ id }] = await deps.db.$queryRaw<{ id: string }[]>`SELECT id::text FROM deals WHERE public_code = ${code}`;
  return { code, id, view };
}

/** Every row the deal owns, straight from Postgres. */
async function rawRows(id: string) {
  const db = deps.db;
  return {
    deal: (await db.$queryRaw<{ source_text: string; item_title: string; updated_at: Date }[]>`SELECT source_text, item_title, updated_at FROM deals WHERE id = ${id}::uuid`)[0]!,
    conditions: await db.$queryRaw<{ text: string }[]>`SELECT text FROM conditions WHERE deal_id = ${id}::uuid`,
    evidence: await db.$queryRaw<{ kind: string; value: string | null }[]>`SELECT kind::text, value FROM evidence WHERE deal_id = ${id}::uuid`,
    files: await db.$queryRaw<{ bytes: Uint8Array }[]>`SELECT bytes FROM files WHERE deal_id = ${id}::uuid`,
    verdicts: await db.$queryRaw<{ reason: string; raw_response: unknown }[]>`SELECT reason, raw_response FROM verdicts WHERE deal_id = ${id}::uuid`,
    events: await db.$queryRaw<{ cause: string; payload: Record<string, unknown> }[]>`SELECT cause, payload FROM deal_events WHERE deal_id = ${id}::uuid ORDER BY id`,
    json: (await db.$queryRaw<{ t: string }[]>`
      SELECT row_to_json(d)::text AS t FROM deals d WHERE d.id = ${id}::uuid
      UNION ALL SELECT row_to_json(c)::text FROM conditions c WHERE c.deal_id = ${id}::uuid
      UNION ALL SELECT row_to_json(e)::text FROM evidence e WHERE e.deal_id = ${id}::uuid
      UNION ALL SELECT row_to_json(v)::text FROM verdicts v WHERE v.deal_id = ${id}::uuid
      UNION ALL SELECT row_to_json(x)::text FROM deal_events x WHERE x.deal_id = ${id}::uuid`).map((r) => r.t).join("\n"),
  };
}

type Route = Parameters<typeof callRoute>[0];
const kidOfBytes = (b: Uint8Array) => Buffer.from(b.subarray(3, 3 + b[2]!)).toString("ascii");

async function fetchFile(url: string, id: string): Promise<Buffer> {
  const u = new URL(url, "http://localhost");
  const res = await callRoute(download as Route, "GET", u.pathname + u.search, { params: { id } });
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

describe("contract data at rest", () => {
  test("every sealed column holds only sealed values, no plaintext anywhere in the rows, and every app read returns plain values", async () => {
    const { code, id, view } = await fullDeal();
    expect(view.status).toBe("captured");
    const plain = [DEFAULT_TEXT, view.item_title, ...view.conditions.map((c) => c.text), TRACKING, NOTE, REASON];
    expect(view.conditions.length).toBeGreaterThanOrEqual(3);

    const raw = await rawRows(id);
    const enc = expect.stringMatching(/^enc1\.k1\./);
    expect(raw.deal).toMatchObject({ source_text: enc, item_title: enc });
    expect(raw.conditions.length).toBe(view.conditions.length);
    for (const c of raw.conditions) expect(c.text).toEqual(enc);
    expect(raw.evidence.filter((e) => e.kind !== "photo").map((e) => e.kind).sort()).toEqual(["note", "tracking"]);
    for (const e of raw.evidence) if (e.kind !== "photo") expect(e.value).toEqual(enc);
    expect(raw.files).toHaveLength(3);
    for (const f of raw.files) {
      expect([f.bytes[0], f.bytes[1]]).toEqual([0x45, 0x31]);
      expect(Buffer.from(f.bytes).includes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false); // no JPEG header in the clear
    }
    expect(raw.verdicts).toHaveLength(view.conditions.length);
    for (const v of raw.verdicts) {
      expect(v.reason).toEqual(enc);
      expect(v.raw_response).toEqual({ sealed: enc });
    }
    const sealedKeys = raw.events.flatMap((e) => EVENT_SEALED_KEYS.filter((k) => typeof e.payload[k] === "string").map((k) => [e.cause, k, e.payload[k]]));
    expect(sealedKeys.map(([cause, k]) => `${cause}.${k}`)).toEqual(["create.source_text", "submit_evidence.tracking_number"]);
    for (const [, , v] of sealedKeys) expect(v).toEqual(enc);
    for (const s of plain) expect(raw.json, s).not.toContain(s);

    // The app reads plain values.
    expect(view).toMatchObject({ source_text: DEFAULT_TEXT, item_title: "Hand-painted denim jacket" });
    expect(view.submissions[0]).toMatchObject({ note: NOTE, tracking_number: TRACKING });
    expect(view.submissions[0]!.verdicts[0]!.reason).toBe(REASON);
    expect((await listDeals(p.asBuyer, deps))[0]).toMatchObject({ code, item_title: "Hand-painted denim jacket" });
    const events = await getEvents(code, p.asSeller, deps);
    expect(events.find((e) => e.cause === "create")!.payload.source_text).toBe(DEFAULT_TEXT);
    expect(events.find((e) => e.cause === "submit_evidence")!.payload.tracking_number).toBe(TRACKING);
    const pack = await getEvidencePack(code, p.asBuyer, deps);
    expect(pack.deal).toMatchObject({ source_text: DEFAULT_TEXT, item_title: "Hand-painted denim jacket" });
    expect(pack.conditions.map((c) => c.text)).toEqual(view.conditions.map((c) => c.text));
    expect(pack.submissions[0]!.verdicts[0]).toMatchObject({ reason: REASON, raw_response: expect.objectContaining({ request_id: "req_fake" }) });
    const ref = view.reference_files[0]!;
    expect((await fetchFile(ref.url, ref.id)).equals(Buffer.from(REF))).toBe(true);
    // PayPal saw the plain item title in the order description.
    expect(JSON.stringify(deps.paypal.calls)).toContain("Hand-painted denim jacket");
  });

  test("a sealed value copied into another deal fails to open: SealError, a 500 internal_error with no plaintext; plaintext is refused by the database", async () => {
    const a = await build.draft();
    const b = await build.draft();
    await deps.db.$executeRaw`UPDATE deals SET source_text = (SELECT source_text FROM deals WHERE public_code = ${a}) WHERE public_code = ${b}`;
    await expect(getDeal(b, p.asBuyer, deps)).rejects.toBeInstanceOf(SealError);
    await expect(listDeals(p.asBuyer, deps)).rejects.toBeInstanceOf(SealError);
    const res = await callRoute(read as Route, "GET", `/api/deals/${b}`, { cookie: await signIn(p.buyer.id), params: { code: b } });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body).error.code).toBe("internal_error");
    expect(body).not.toContain(DEFAULT_TEXT);
    expect(await getDeal(a, p.asBuyer, deps)).toMatchObject({ source_text: DEFAULT_TEXT });

    await expect(deps.db.$executeRaw`UPDATE deals SET item_title = 'plain title' WHERE public_code = ${a}`).rejects.toThrow(/deals_item_title_sealed/);
  });

  test("npm run reseal moves every mutable column to the new key, is idempotent, and leaves event payloads on the old kid", async () => {
    const { code, id, view } = await fullDeal();
    const before = await rawRows(id);
    const oldKid = keyring().active;
    process.env.DATA_KEYS = `k2:${"rotated-test-key-".repeat(3)},${KEYS}`;

    const first = await reseal(deps.db);
    expect(first).toEqual({ deals: 1, values: 2 + 3 * view.conditions.length + 2 + 3, event_kids: [oldKid] });

    const raw = await rawRows(id);
    const enc2 = expect.stringMatching(/^enc1\.k2\./);
    expect(raw.deal).toMatchObject({ source_text: enc2, item_title: enc2, updated_at: before.deal.updated_at });
    for (const c of raw.conditions) expect(c.text).toEqual(enc2);
    for (const e of raw.evidence) if (e.value !== null) expect(e.value).toEqual(enc2);
    for (const f of raw.files) expect(kidOfBytes(f.bytes)).toBe("k2");
    for (const v of raw.verdicts) expect(v).toEqual({ reason: enc2, raw_response: { sealed: enc2 } });
    expect(raw.events).toEqual(before.events); // append-only: untouched

    const after = (await getDeal(code, p.asBuyer, deps)) as DealView;
    expect(after).toEqual(view);
    expect((await fetchFile(after.reference_files[0]!.url, after.reference_files[0]!.id)).equals(Buffer.from(REF))).toBe(true);

    expect(await reseal(deps.db)).toEqual({ deals: 1, values: 0, event_kids: [oldKid] });

    // Why the old kid must stay while events use it: without it the deal no longer opens.
    process.env.DATA_KEYS = `k2:${"rotated-test-key-".repeat(3)}`;
    await expect(getDeal(code, p.asBuyer, deps)).rejects.toThrow(SealError);
  });
});
