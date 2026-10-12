// 06 "Security checks", first box (F4, H2): a third signed-in user gets not_a_party from every read, upload and command on a
// deal in every status past the draft preview, and the attempts change nothing: no event, no PayPal call, same status.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { addFile, getDeal, getEvents, getEvidencePack, handle, listDeals } from "@/lib/deal";
import type { Command } from "@/lib/deal/types";
import { prisma } from "@/lib/db";
import { assertEventsInC6, dealBuilder, events, expectError, parties, resetDb, signedAccept, testDeps, type Parties, type TestDeps } from "./helpers";

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

const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, ...new Array(97).fill(0)]);

const STATUSES = {
  joined: () => build.joined(),
  terms_agreed: () => build.agreed(),
  held: () => build.held(),
  in_review: () => build.inReview(),
  paid: () => build.captured(),
  voided: async () => {
    const code = await build.agreed();
    await handle(code, p.asBuyer, { type: "cancel" }, deps);
    return code;
  },
} as const;

describe.each(Object.keys(STATUSES) as (keyof typeof STATUSES)[])("third user on a %s deal", (status) => {
  test("every read, upload and command -> not_a_party, and nothing changes", async () => {
    const code = await STATUSES[status]();
    const before = { deal: await prisma.deal.findUniqueOrThrow({ where: { public_code: code }, select: { status: true, terms_version: true } }), events: (await events(code)).length, paypal: deps.paypal.calls.length };

    const commands: Command[] = [
      { type: "join" },
      await signedAccept(code, p.asThird, before.deal.terms_version),
      { type: "edit_terms", item_title: "Mine now", amount_minor: 1, deadline_days: 1, conditions: [{ text: "Anything", evidence_type: "photo" }] },
      { type: "start_payment" },
      { type: "confirm_approval", order_id: "ORD-1" },
      { type: "submit_evidence", file_ids: [], tracking_number: null, note: null },
      { type: "review", decision: "approve", note: null },
      { type: "review", decision: "reject", note: null },
      { type: "cancel" },
      { type: "retry_payout" },
    ];
    for (const c of commands) await expectError(handle(code, p.asThird, c, deps), "not_a_party");
    await expectError(getDeal(code, p.asThird, deps), "not_a_party");
    await expectError(getEvents(code, p.asThird, deps), "not_a_party");
    await expectError(getEvidencePack(code, p.asThird, deps), "not_a_party");
    for (const purpose of ["reference", "evidence"] as const) await expectError(addFile(code, p.asThird, { purpose, mime: "image/jpeg", bytes: jpeg() }, deps), "not_a_party");
    expect((await listDeals(p.asThird, deps)).map((r) => r.code)).not.toContain(code);

    expect(await prisma.deal.findUniqueOrThrow({ where: { public_code: code }, select: { status: true, terms_version: true } })).toEqual(before.deal);
    expect((await events(code)).length).toBe(before.events);
    expect(deps.paypal.calls.length).toBe(before.paypal);
    expect(await prisma.file.count({ where: { deal: { public_code: code }, uploaded_by: p.third.id } })).toBe(0);
  });
});
