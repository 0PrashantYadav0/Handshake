// 06 "One per command": start_payment (6 h reuse, order-{code}-2), confirm_approval (every bullet), cancel (every bullet incl. C4).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { handle } from "@/lib/deal";
import { toIso } from "@/lib/deal/dates";
import { authKey, captureKey, orderKey, voidKey } from "@/lib/deal/keys";
import { assertEventsInC6, CLOCK_START, dealBuilder, dealRow, events, expectError, parties, resetDb, testDeps, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
const H = 3600_000;
const D = 24 * H;

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});
afterEach(assertEventsInC6);

const calls = (op: string) => deps.paypal.calls.filter((c) => c.op === op);
const startPayment = (code: string) => handle(code, p.asBuyer, { type: "start_payment" }, deps);
const confirm = (code: string, order_id: string) => handle(code, p.asBuyer, { type: "confirm_approval", order_id }, deps);
const cancel = (code: string, actor = p.asBuyer) => handle(code, actor, { type: "cancel" }, deps);

describe("start_payment", () => {
  test("creates order-{code}-1, upserts payments, writes start_payment; reuses under 6 h; new key after 6 h", async () => {
    const code = await build.agreed();
    const v = await startPayment(code);
    expect(v.payment).toMatchObject({ status: "created", paypal_order_id: "ORD-1", authorization_id: null });
    expect(calls("createAuthorizeOrder")).toEqual([{ op: "createAuthorizeOrder", requestId: orderKey(code, 1), args: { code, amount_minor: 8000, description: "Hand-painted denim jacket" } }]);
    expect((await dealRow(code)).payment).toMatchObject({ status: "created", order_attempts: 1 });
    expect((await events(code)).at(-1)).toMatchObject({ from_status: "terms_agreed", to_status: "terms_agreed", actor: "buyer", cause: "start_payment", payload: { paypal_order_id: "ORD-1", order_attempt: 1 } });

    deps.clock.advance(H);
    expect((await startPayment(code)).payment!.paypal_order_id).toBe("ORD-1");
    expect(calls("createAuthorizeOrder")).toHaveLength(1);
    const ev = await events(code);
    expect(ev.filter((e) => e.cause === "start_payment")).toHaveLength(2);
    expect(ev.at(-1)!.payload).toEqual({ paypal_order_id: "ORD-1", order_attempt: 1 });

    deps.clock.advance(5 * H + 1000);
    expect((await startPayment(code)).payment!.paypal_order_id).toBe("ORD-2");
    expect(calls("createAuthorizeOrder").at(-1)!.requestId).toBe(orderKey(code, 2));
    expect((await dealRow(code)).payment).toMatchObject({ paypal_order_id: "ORD-2", order_attempts: 2, status: "created" });
    expect((await events(code)).at(-1)!.payload).toEqual({ paypal_order_id: "ORD-2", order_attempt: 2 });
  });
  test("an approved order (no longer 'still created') gets order-{code}-2 without the clock moving", async () => {
    const code = await build.agreed();
    await startPayment(code);
    deps.paypal.orders.get("ORD-1")!.status = "APPROVED";
    deps.paypal.failNext("authorizeOrder", { status: 500, name: "INTERNAL_SERVER_ERROR" });
    await expectError(confirm(code, "ORD-1"), "paypal_error");
    expect((await dealRow(code)).payment!.status).toBe("approved");
    expect((await startPayment(code)).payment!.paypal_order_id).toBe("ORD-2");
    expect(calls("createAuthorizeOrder").at(-1)!.requestId).toBe(orderKey(code, 2));
  });
  test("draft -> terms_not_accepted; seller -> not_a_party; a stored PENDING hold -> invalid_state; PayPal 500 -> paypal_error with nothing written", async () => {
    const draft = await build.joined();
    await expectError(startPayment(draft), "terms_not_accepted");
    const code = await build.agreed();
    await expectError(handle(code, p.asSeller, { type: "start_payment" }, deps), "not_a_party");

    deps.paypal.failNext("createAuthorizeOrder", { status: 500, name: "INTERNAL_SERVER_ERROR" });
    const n = (await events(code)).length;
    await expectError(startPayment(code), "paypal_error");
    expect((await dealRow(code)).payment).toBeNull();
    expect(await events(code)).toHaveLength(n);

    await startPayment(code);
    deps.paypal.authorizeStatus = "PENDING";
    await expectError(confirm(code, "ORD-1"), "paypal_error");
    expect((await dealRow(code)).payment).toMatchObject({ status: "approved", authorization_id: "AUTH-1" });
    await expectError(startPayment(code), "invalid_state");
  });
});

describe("confirm_approval", () => {
  test("CREATED: held, payment authorized, deadline_at, one fact:authorization_created event with source api", async () => {
    const code = await build.agreed();
    await startPayment(code);
    const n = (await events(code)).length;
    const v = await confirm(code, "ORD-1");
    expect(calls("authorizeOrder")).toEqual([{ op: "authorizeOrder", requestId: authKey(code), args: { paypal_order_id: "ORD-1" } }]);
    const expires = toIso(new Date(new Date(CLOCK_START).getTime() + 29 * D));
    expect(v).toMatchObject({ status: "held", deadline_at: toIso(new Date(new Date(CLOCK_START).getTime() + 7 * D)) });
    expect(v.payment).toEqual({ status: "authorized", paypal_order_id: "ORD-1", authorization_id: "AUTH-1", authorized_at: CLOCK_START, auth_expires_at: expires, capture_id: null });
    const ev = await events(code);
    expect(ev).toHaveLength(n + 1);
    expect(ev.at(-1)).toMatchObject({ from_status: "terms_agreed", to_status: "held", actor: "paypal", cause: "fact:authorization_created" });
    expect(ev.at(-1)!.payload).toEqual({ authorization_id: "AUTH-1", auth_expires_at: expires, source: "api", paypal_request_id: authKey(code) });
  });
  test("wrong order_id -> invalid_input; PENDING -> paypal_error and ids stored; DENIED -> paypal_error", async () => {
    const code = await build.agreed();
    await startPayment(code);
    await expectError(confirm(code, "ORD-9"), "invalid_input");
    expect((await dealRow(code)).payment!.status).toBe("created");

    deps.paypal.authorizeStatus = "PENDING";
    const e = await expectError(confirm(code, "ORD-1"), "paypal_error");
    expect(e.message).toContain("PayPal did not place the hold (PENDING)");
    expect((await dealRow(code))).toMatchObject({ status: "terms_agreed", payment: { status: "approved", authorization_id: "AUTH-1" } });
    expect((await events(code)).at(-1)!.cause).toBe("start_payment");

    const code2 = await build.agreed();
    await startPayment(code2);
    deps.paypal.authorizeStatus = "DENIED";
    await expectError(confirm(code2, "ORD-2"), "paypal_error");
    expect((await dealRow(code2))).toMatchObject({ status: "terms_agreed", payment: { status: "approved", authorization_id: null } });
  });
  test("already held: 200 with no second authorizeOrder call; draft -> terms_not_accepted; held with another order -> invalid_state; seller -> 403", async () => {
    const code = await build.held();
    const v = await confirm(code, "ORD-1");
    expect(v.status).toBe("held");
    expect(calls("authorizeOrder")).toHaveLength(1);
    await expectError(confirm(code, "ORD-9"), "invalid_state");
    await expectError(handle(code, p.asSeller, { type: "confirm_approval", order_id: "ORD-1" }, deps), "not_a_party");
    const draft = await build.joined();
    await expectError(confirm(draft, "ORD-1"), "terms_not_accepted");
  });
  test("cancelled while PayPal was answering: the late authorization is voided at once with void-{code}", async () => {
    const code = await build.agreed();
    await startPayment(code);
    let release!: () => void;
    deps.paypal.hangUntil("authorizeOrder", new Promise<void>((r) => (release = r)));
    const pending = confirm(code, "ORD-1");
    await new Promise((r) => setTimeout(r, 100)); // Tx-before committed, the call is in flight
    await cancel(code);
    release();
    const v = await pending;
    expect(v.status).toBe("voided");
    expect(calls("voidAuthorization")).toEqual([{ op: "voidAuthorization", requestId: voidKey(code), args: { authorization_id: "AUTH-1" } }]);
    expect((await dealRow(code)).payment).toMatchObject({ status: "voided", authorization_id: "AUTH-1" });
    const ev = await events(code);
    expect(ev.at(-2)).toMatchObject({ cause: "cancel", payload: { authorization_id: null, voided: false } });
    expect(ev.at(-1)).toMatchObject({ from_status: "voided", to_status: "voided", actor: "paypal", cause: "fact:late_authorization_voided", payload: { authorization_id: "AUTH-1", source: "api" } });
  });
});

describe("cancel", () => {
  test("draft and terms_agreed with an unapproved order: voided, no PayPal call", async () => {
    const draft = await build.draft();
    const v = await cancel(draft);
    expect(v.status).toBe("voided");
    expect((await events(draft)).at(-1)).toMatchObject({ from_status: "draft", to_status: "voided", actor: "buyer", cause: "cancel", payload: { authorization_id: null, voided: false } });

    const agreed = await build.agreed();
    await startPayment(agreed);
    const n = (await events(agreed)).length;
    await cancel(agreed, p.asSeller);
    expect(calls("voidAuthorization")).toHaveLength(0);
    expect((await dealRow(agreed))).toMatchObject({ status: "voided", payment: { status: "created" } });
    const ev = await events(agreed);
    expect(ev).toHaveLength(n + 1);
    expect(ev.at(-1)).toMatchObject({ from_status: "terms_agreed", to_status: "voided", actor: "seller", cause: "cancel", payload: { authorization_id: null, voided: false } });
  });
  test("held: void-{code} on AUTH-1, payment voided, cancel event then the api-sourced fact", async () => {
    const code = await build.held();
    const n = (await events(code)).length;
    const v = await cancel(code);
    expect(v.status).toBe("voided");
    expect(calls("voidAuthorization")).toEqual([{ op: "voidAuthorization", requestId: voidKey(code), args: { authorization_id: "AUTH-1" } }]);
    expect((await dealRow(code)).payment!.status).toBe("voided");
    const ev = await events(code);
    expect(ev).toHaveLength(n + 2);
    expect(ev.at(-2)).toMatchObject({ from_status: "held", to_status: "voided", actor: "buyer", cause: "cancel", payload: { authorization_id: "AUTH-1", voided: true } });
    expect(ev.at(-1)).toMatchObject({ from_status: "voided", to_status: "voided", actor: "paypal", cause: "fact:authorization_voided", payload: { authorization_id: "AUTH-1", source: "api", paypal_request_id: voidKey(code) } });
  });
  test("a stored PENDING hold is voided too; PREVIOUSLY_VOIDED counts as success", async () => {
    const code = await build.agreed();
    await startPayment(code);
    deps.paypal.authorizeStatus = "PENDING";
    await expectError(confirm(code, "ORD-1"), "paypal_error");
    await cancel(code);
    expect(calls("voidAuthorization").at(-1)).toMatchObject({ requestId: voidKey(code), args: { authorization_id: "AUTH-1" } });
    expect((await dealRow(code))).toMatchObject({ status: "voided", payment: { status: "voided" } });

    deps.paypal.authorizeStatus = "CREATED";
    const held = await build.held();
    deps.paypal.failNext("voidAuthorization", { status: 422, name: "PREVIOUSLY_VOIDED" });
    expect((await cancel(held)).status).toBe("voided");
  });
  test("void 500 -> paypal_error, nothing written", async () => {
    const code = await build.held();
    const n = (await events(code)).length;
    deps.paypal.failNext("voidAuthorization", { status: 500, name: "INTERNAL_SERVER_ERROR" });
    const e = await expectError(cancel(code), "paypal_error");
    expect(e.message).toContain("INTERNAL_SERVER_ERROR");
    expect((await dealRow(code))).toMatchObject({ status: "held", payment: { status: "authorized" } });
    expect(await events(code)).toHaveLength(n);
  });
  test("C4: void refused as already captured -> capture-{code}-0 re-sent, fact applied, invalid_state, no cancel event", async () => {
    const code = await build.held();
    const n = (await events(code)).length;
    deps.paypal.failNext("voidAuthorization", { status: 422, name: "AUTHORIZATION_ALREADY_CAPTURED" });
    const e = await expectError(cancel(code), "invalid_state");
    expect(e.message).toBe("The payment was already captured");
    expect(calls("captureAuthorization")).toEqual([{ op: "captureAuthorization", requestId: captureKey(code, 0), args: { authorization_id: "AUTH-1", amount_minor: 8000 } }]);
    const row = await dealRow(code);
    expect(row.status).toBe("held"); // C2: capture_completed moves only proof_submitted / in_review; held keeps its status
    expect(row.payment).toMatchObject({ status: "captured", capture_id: "CAP-1" });
    const ev = await events(code);
    expect(ev).toHaveLength(n + 1);
    expect(ev.at(-1)).toMatchObject({ from_status: "held", to_status: "held", actor: "paypal", cause: "fact:capture_completed", payload: { capture_id: "CAP-1", source: "api", paypal_request_id: captureKey(code, 0) } });
    expect(ev.at(-1)!.payload).not.toHaveProperty("payout");
    expect(ev.some((x) => x.cause === "cancel")).toBe(false);
  });
  test("C4 with the re-sent capture also failing -> the original void error as paypal_error, nothing written", async () => {
    const code = await build.held();
    const n = (await events(code)).length;
    deps.paypal.failNext("voidAuthorization", { status: 422, name: "AUTHORIZATION_ALREADY_CAPTURED" });
    deps.paypal.failNext("captureAuthorization", { status: 500, name: "INTERNAL_SERVER_ERROR" });
    const e = await expectError(cancel(code), "paypal_error");
    expect(e.message).toContain("AUTHORIZATION_ALREADY_CAPTURED");
    expect((await dealRow(code))).toMatchObject({ status: "held", payment: { status: "authorized", capture_id: null } });
    expect(await events(code)).toHaveLength(n);
  });
  test("voided again -> invalid_state; third user -> not_a_party", async () => {
    const code = await build.held();
    await cancel(code);
    await expectError(cancel(code), "invalid_state");
    await expectError(cancel(code, p.asThird), "not_a_party");
  });
});
