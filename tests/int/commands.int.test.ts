// 06 "One per command": create, edit_terms, join, accept; "Terms versioning"; seeded deals. Module calls, no routes (T-16).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createDeal, handle } from "@/lib/deal";
import { DEFAULT_EXTRACT } from "@/lib/ai/fake";
import { CODE_RE } from "@/lib/deal/code";
import { CODE_CONDITION } from "@/lib/deal/terms";
import type { Command, ConditionInput } from "@/lib/deal/types";
import { assertEventsInC6, dealBuilder, dealRow, events, expectError, parties, resetDb, testDeps, type Parties, type TestDeps, signedAccept } from "./helpers";

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

const TERMS: Command = {
  type: "edit_terms", item_title: "Jacket", amount_minor: 9000, deadline_days: 10,
  conditions: [{ text: "Item matches the listing photos", evidence_type: "photo" }, { text: "Tracking shows delivered", evidence_type: "tracking" }],
};

describe("create", () => {
  test("draft, terms_version 1, code condition appended, one create event", async () => {
    const v = await createDeal(p.asBuyer, { text: "I'll pay $80 for the jacket once it matches the photos" }, deps);
    expect(v.code).toMatch(CODE_RE);
    expect(v).toMatchObject({ role: "buyer", status: "draft", terms_version: 1, amount_minor: 8000, deadline_days: 7, seller: null, payment: null, payouts: [], rejected: [] });
    expect(v.conditions.map((c) => [c.position, c.evidence_type, c.system])).toEqual([[1, "photo", false], [2, "tracking", false], [3, "photo", true]]);
    expect(v.conditions[2]!.text).toBe(CODE_CONDITION(v.code));
    expect(deps.ai.calls.filter((c) => c.job === "extract")).toHaveLength(1);
    const ev = await events(v.code);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ from_status: null, to_status: "draft", actor: "buyer", cause: "create" });
    expect(ev[0]!.payload).toEqual({ source_text: "I'll pay $80 for the jacket once it matches the photos", model: "fake", prompt_version: "extract-v1", rejected: [] });
  });
  test("text limits and an unavailable model", async () => {
    await expectError(createDeal(p.asBuyer, { text: " " }, deps), "invalid_input");
    await expectError(createDeal(p.asBuyer, { text: "x".repeat(501) }, deps), "invalid_input");
    deps.ai.extractWith("timeout");
    await expectError(createDeal(p.asBuyer, { text: "pay $5" }, deps), "ai_unavailable");
    expect(await deps.db.deal.count()).toBe(0);
  });
  test("only a tracking condition -> no code condition", async () => {
    deps.ai.extractWith({ item_title: "Lamp", amount_minor: 1500, currency: "USD", deadline_days: 3, conditions: [{ text: "Tracking shows delivered", evidence_type: "tracking" }], rejected: [] });
    const v = await createDeal(p.asBuyer, { text: "pay $15 when delivered" }, deps);
    expect(v.conditions).toHaveLength(1);
  });
});

describe("edit_terms", () => {
  test("draft with buyer accepted: version 2, both acceptances cleared, one event with changed[]", async () => {
    const code = await build.joined(); // trust spec §6: both parties are named before anyone signs
    await handle(code, p.asBuyer, await signedAccept(code, p.asBuyer, 1), deps);
    const v = await handle(code, p.asBuyer, TERMS, deps);
    expect(v).toMatchObject({ status: "draft", terms_version: 2, buyer_accepted_version: null, seller_accepted_version: null, item_title: "Jacket", amount_minor: 9000, deadline_days: 10 });
    const ev = (await events(code)).at(-1)!;
    expect(ev).toMatchObject({ from_status: "draft", to_status: "draft", actor: "buyer", cause: "edit_terms" });
    expect(ev.payload).toEqual({ terms_version: 2, changed: ["item_title", "amount_minor", "deadline_days"] });
  });
  test("from terms_agreed: back to draft; with a payments row: invalid_state", async () => {
    const code = await build.agreed();
    const v = await handle(code, p.asBuyer, TERMS, deps);
    expect(v).toMatchObject({ status: "draft", terms_version: 2 });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "terms_agreed", to_status: "draft", cause: "edit_terms" });

    const code2 = await build.agreed();
    await handle(code2, p.asBuyer, { type: "start_payment" }, deps);
    const e = await expectError(handle(code2, p.asBuyer, TERMS, deps), "invalid_state");
    expect(e.message).toBe("Payment has started; cancel the deal to change the terms.");
  });
  test("wrong role, wrong state", async () => {
    const code = await build.joined();
    await expectError(handle(code, p.asSeller, TERMS, deps), "not_a_party");
    await expectError(handle(code, p.asThird, TERMS, deps), "not_a_party");
    const held = await build.held();
    await expectError(handle(held, p.asBuyer, TERMS, deps), "invalid_state");
  });
  test("conditions: code condition stripped and re-appended last; limits (D6, H3)", async () => {
    const code = await build.draft();
    const photo = (text: string) => ({ text, evidence_type: "photo" as const });
    const edit = (conditions: ConditionInput[]) => handle(code, p.asBuyer, { ...TERMS, conditions }, deps);

    const moved = await edit([photo(CODE_CONDITION(code)), photo("A"), photo("B"), photo("C"), photo("D")]);
    expect(moved.conditions.map((c) => c.text)).toEqual(["A", "B", "C", "D", CODE_CONDITION(code)]);
    expect(moved.conditions.at(-1)).toMatchObject({ position: 5, system: true });

    await expectError(edit([photo("A"), photo("B"), photo("C"), photo("D"), photo("E")]), "invalid_input");
    await expectError(edit([]), "invalid_input");
    await expectError(edit([photo("x".repeat(201))]), "invalid_input");
    const tracking = await edit([{ text: "Tracking shows delivered", evidence_type: "tracking" }]);
    expect(tracking.conditions.map((c) => c.text)).toEqual(["Tracking shows delivered"]);
    expect((await dealRow(code)).conditions).toHaveLength(1);
  });
  test("unchanged terms still write the event with changed: []", async () => {
    const code = await build.draft();
    const v = await handle(code, p.asBuyer, { type: "edit_terms", item_title: "Hand-painted denim jacket", amount_minor: 8000, deadline_days: 7, conditions: [
      { text: "Item matches the listing photos", evidence_type: "photo" }, { text: "Tracking shows delivered", evidence_type: "tracking" }] }, deps);
    expect(v.terms_version).toBe(2);
    expect((await events(code)).at(-1)!.payload).toEqual({ terms_version: 2, changed: [] });
  });
});

describe("join", () => {
  test("seller joins a draft: seller_id set, one join event, role seller", async () => {
    const code = await build.draft();
    const v = await handle(code, p.asSeller, { type: "join" }, deps);
    expect(v.role).toBe("seller");
    expect(v.seller).toMatchObject({ email: "seller@test", has_paypal_email: true, paypal_email: "seller-pp@test" });
    expect((await dealRow(code)).seller_id).toBe(p.seller.id);
    const ev = await events(code);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ from_status: "draft", to_status: "draft", actor: "seller", cause: "join", payload: { seller_id: p.seller.id } });
  });
  test("the buyer, a third user after a seller exists, and a repeat join", async () => {
    const code = await build.draft();
    const e = await expectError(handle(code, p.asBuyer, { type: "join" }, deps), "not_a_party");
    expect(e.message).toBe("You are the buyer of this deal.");
    await handle(code, p.asSeller, { type: "join" }, deps);
    await expectError(handle(code, p.asThird, { type: "join" }, deps), "not_a_party");
    const again = await handle(code, p.asSeller, { type: "join" }, deps);
    expect(again.role).toBe("seller");
    expect(await events(code)).toHaveLength(2);
  });
});

describe("accept", () => {
  test("seller then buyer: draft, then terms_agreed, two accept events", async () => {
    const code = await build.joined();
    const afterSeller = await handle(code, p.asSeller, await signedAccept(code, p.asSeller, 1), deps);
    expect(afterSeller).toMatchObject({ status: "draft", seller_accepted_version: 1, buyer_accepted_version: null });
    const afterBuyer = await handle(code, p.asBuyer, await signedAccept(code, p.asBuyer, 1), deps);
    expect(afterBuyer).toMatchObject({ status: "terms_agreed", seller_accepted_version: 1, buyer_accepted_version: 1 });
    const ev = (await events(code)).slice(-2);
    expect(ev[0]).toMatchObject({ from_status: "draft", to_status: "draft", actor: "seller", cause: "accept", payload: { terms_version: 1 } });
    expect(ev[1]).toMatchObject({ from_status: "draft", to_status: "terms_agreed", actor: "buyer", cause: "accept", payload: { terms_version: 1 } });
  });
  test("seller without paypal_email -> paypal_email_required and nothing written", async () => {
    const code = await build.joined();
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: null } });
    const before = (await events(code)).length;
    await expectError(handle(code, p.asSeller, await signedAccept(code, p.asSeller, 1), deps), "paypal_email_required");
    expect((await dealRow(code)).seller_accepted_version).toBeNull();
    expect(await events(code)).toHaveLength(before);
  });
  test("the buyer's completing accept also needs the seller's paypal_email", async () => {
    const code = await build.joined();
    await handle(code, p.asSeller, await signedAccept(code, p.asSeller, 1), deps);
    await deps.db.user.update({ where: { id: p.seller.id }, data: { paypal_email: null } });
    await expectError(handle(code, p.asBuyer, await signedAccept(code, p.asBuyer, 1), deps), "paypal_email_required");
    expect((await dealRow(code)).status).toBe("draft");
  });
  test("version mismatch, null amount, same version twice, wrong state, non-party", async () => {
    const code = await build.joined();
    await handle(code, p.asBuyer, TERMS, deps); // version 2
    await expectError(handle(code, p.asBuyer, await signedAccept(code, p.asBuyer, 1), deps), "terms_version_mismatch");

    deps.ai.extractWith({ item_title: "Lamp", amount_minor: null, currency: null, deadline_days: null, conditions: [{ text: "Photo shows the lamp", evidence_type: "photo" }], rejected: [] });
    const noAmount = await build.draft("pay for the lamp");
    const e = await expectError(handle(noAmount, p.asBuyer, await signedAccept(noAmount, p.asBuyer, 1), deps), "invalid_input");
    expect(e.message).toBe("Set the amount and the deadline before accepting.");
    deps.ai.extractWith(DEFAULT_EXTRACT);

    const agreedCode = await build.agreed();
    await expectError(handle(agreedCode, p.asBuyer, await signedAccept(agreedCode, p.asBuyer, 1), deps), "invalid_state");
    await expectError(handle(code, p.asThird, await signedAccept(code, p.asThird, 2), deps), "not_a_party");

    const twice = await build.joined();
    await handle(twice, p.asBuyer, await signedAccept(twice, p.asBuyer, 1), deps);
    const n = (await events(twice)).length;
    await handle(twice, p.asBuyer, await signedAccept(twice, p.asBuyer, 1), deps);
    expect(await events(twice)).toHaveLength(n);
  });
  test("terms versioning: a new deal is at 1 with null acceptances; after an edit the seller's accept of 2 leaves draft", async () => {
    const code = await build.joined();
    expect(await dealRow(code)).toMatchObject({ terms_version: 1, buyer_accepted_version: null, seller_accepted_version: null });
    await handle(code, p.asBuyer, await signedAccept(code, p.asBuyer, 1), deps);
    await handle(code, p.asBuyer, TERMS, deps);
    const v = await handle(code, p.asSeller, await signedAccept(code, p.asSeller, 2), deps);
    expect(v).toMatchObject({ status: "draft", terms_version: 2, seller_accepted_version: 2, buyer_accepted_version: null });
    expect((await handle(code, p.asBuyer, await signedAccept(code, p.asBuyer, 2), deps)).status).toBe("terms_agreed");
  });
});

describe("seeded deals", () => {
  test("every command on a seeded deal is invalid_state", async () => {
    const code = await build.joined();
    await deps.db.deal.update({ where: { public_code: code }, data: { seeded: true } });
    for (const cmd of [{ type: "accept", terms_version: 1 }, { type: "cancel" }, { type: "join" }, TERMS] as Command[]) {
      const e = await expectError(handle(code, p.asBuyer, cmd, deps), "invalid_state");
      expect(e.message).toBe("This is a historical demo deal.");
    }
    expect(await events(code)).toHaveLength(2);
  });
  test("submit_evidence, review and retry_payout on a seeded deal are invalid_state too", async () => {
    const code = await build.held();
    await deps.db.deal.update({ where: { public_code: code }, data: { seeded: true } });
    const n = (await events(code)).length;
    await expectError(handle(code, p.asSeller, { type: "submit_evidence", file_ids: [], tracking_number: null, note: null }, deps), "invalid_state");
    await expectError(handle(code, p.asBuyer, { type: "review", decision: "approve", note: null }, deps), "invalid_state");
    await expectError(handle(code, p.asSeller, { type: "retry_payout" }, deps), "invalid_state");
    expect(await events(code)).toHaveLength(n);
  });
});
