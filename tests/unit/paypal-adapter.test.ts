import { readFileSync } from "node:fs";
import { ApiError, PaymentsController } from "@paypal/paypal-server-sdk";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PayPalError, parseAuthorization, parseCapture, parseJson, parsePayout, realPaypal, toPayPalError } from "@/lib/paypal";
import { getToken, resetTokenCache } from "@/lib/paypal/token";

const fixture = (name: string) => readFileSync(`tests/fixtures/paypal/${name}.json`, "utf8");
const json = (name: string) => JSON.parse(fixture(name));
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_API_BASE: "https://api-m.sandbox.paypal.com" };
const TOKEN = json("token").access_token as string;

// An SDK ApiError exactly as @apimatic/core builds it: raw body text, status, headers.
const apiError = (status: number, name: string) =>
  new ApiError({ request: { method: "POST", url: "u" }, response: { statusCode: status, body: fixture(name), headers: {} } }, `HTTP ${status}`);
const res = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "application/json" } });

beforeEach(() => { resetTokenCache(); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test("parses every fixture", () => {
  expect(parseJson<{ id: string }>(fixture("create-order"))?.id).toBe("5O190127TN364715T");
  expect(parseAuthorization(json("authorize-order.created"))).toEqual({ authorization_id: "66P728836U784324A", status: "CREATED", expiration_time: "2026-11-18T15:57:51Z", reason: null });
  const pending = parseAuthorization(json("authorize-order.pending"));
  expect(pending.status).toBe("PENDING");
  expect(pending.reason).toBe("PENDING_REVIEW");
  expect(parseCapture(json("capture.completed"))).toEqual({ capture_id: "5KA38057EC136584R", status: "COMPLETED", reason: null });
  expect(parseCapture(json("capture.pending"))).toMatchObject({ status: "PENDING", reason: "PENDING_REVIEW" });
  expect(parseCapture(json("capture.declined"))).toMatchObject({ status: "DECLINED", reason: "DECLINED_BY_RISK_FRAUD_FILTERS" });
  expect(parsePayout(json("payout.created"))).toEqual({ payout_batch_id: "3TRXJ4Z8XJ8QY", batch_status: "PENDING" });
  expect(parsePayout(json("payout.batch")).batch_status).toBe("SUCCESS");
  expect(parseJson("not json")).toBeNull();
});

test("toPayPalError: ApiError -> (status, details[0].issue ?? name, debug_id, body); timeouts -> (0, timeout)", () => {
  const e = toPayPalError(apiError(422, "capture.error.voided"));
  expect([e.status, e.name_, e.debug_id]).toEqual([422, "AUTHORIZATION_VOIDED", "c4ff2b36d1a07"]);
  expect((e.body as { name: string }).name).toBe("UNPROCESSABLE_ENTITY");
  expect(toPayPalError({ code: "ECONNABORTED", message: "timeout of 10000ms exceeded" })).toMatchObject({ status: 0, name_: "timeout", debug_id: null, body: null });
  expect(toPayPalError(new DOMException("x", "TimeoutError"))).toMatchObject({ status: 0, name_: "timeout" });
});

test("voidAuthorization: PREVIOUSLY_VOIDED resolves, anything else throws PayPalError", async () => {
  const spy = vi.spyOn(PaymentsController.prototype, "voidPayment").mockRejectedValue(apiError(422, "void.previously-voided"));
  await expect(realPaypal(env).voidAuthorization("A1", "void-HS-7K2Q")).resolves.toBeUndefined();
  expect(spy).toHaveBeenCalledWith({ authorizationId: "A1", paypalRequestId: "void-HS-7K2Q" });
  spy.mockRejectedValue(apiError(422, "capture.error.voided"));
  await expect(realPaypal(env).voidAuthorization("A1", "void-HS-7K2Q")).rejects.toMatchObject({ status: 422, name_: "AUTHORIZATION_VOIDED" });
});

test("captureAuthorization on a voided authorization: PayPalError 422 and one log line without bearer or body", async () => {
  vi.spyOn(PaymentsController.prototype, "captureAuthorizedPayment").mockRejectedValue(apiError(422, "capture.error.voided"));
  const err = await realPaypal(env).captureAuthorization("A1", 2500, "capture-HS-7K2Q-0").catch((e) => e);
  expect(err).toBeInstanceOf(PayPalError);
  expect(err).toMatchObject({ status: 422, name_: "AUTHORIZATION_VOIDED", debug_id: "c4ff2b36d1a07" });
  expect(console.error).toHaveBeenCalledTimes(1);
  const line = String(vi.mocked(console.error).mock.calls[0]![0]);
  expect(line).toBe("paypal captureAuthorization failed status=422 name=AUTHORIZATION_VOIDED debug_id=c4ff2b36d1a07");
  expect(line).not.toContain("Bearer");
  expect(line).not.toContain("semantically incorrect");
});

test("token cache: one fetch until expires_in - 60 s", async () => {
  vi.useFakeTimers({ now: new Date("2026-10-10T10:00:00Z") });
  const fetchMock = vi.fn().mockImplementation(async () => res(200, fixture("token")));
  vi.stubGlobal("fetch", fetchMock);
  expect(await getToken(env)).toBe(TOKEN);
  expect(await getToken(env)).toBe(TOKEN);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]![0]).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
  vi.setSystemTime(new Date("2026-10-10T10:00:00Z").getTime() + (31668 - 60) * 1000 - 1);
  await getToken(env);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date("2026-10-10T10:00:00Z").getTime() + (31668 - 60) * 1000);
  await getToken(env);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("createPayout: duplicate sender_batch_id follows the HATEOAS link to the original batch", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(res(200, fixture("token")))
    .mockResolvedValueOnce(res(400, fixture("payout.duplicate")))
    .mockResolvedValueOnce(res(200, fixture("payout.batch")));
  vi.stubGlobal("fetch", fetchMock);
  const out = await realPaypal(env).createPayout(
    { sender_batch_id: "payout-HS-7K2Q-1", sender_item_id: "payout-HS-7K2Q-1", receiver: "s@example.com", amount_minor: 2500, note: "Deal HS-7K2Q" },
    "payout-HS-7K2Q-1",
  );
  expect(out).toEqual({ payout_batch_id: "3TRXJ4Z8XJ8QY", batch_status: "SUCCESS" });
  const [postUrl, post] = fetchMock.mock.calls[1]! as [string, RequestInit];
  expect(postUrl).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
  expect(post.headers).toMatchObject({ "PayPal-Request-Id": "payout-HS-7K2Q-1", Authorization: `Bearer ${TOKEN}` });
  expect(JSON.parse(post.body as string).items[0]).toMatchObject({ recipient_type: "EMAIL", amount: { value: "25.00", currency: "USD" } });
  expect(fetchMock.mock.calls[2]![0]).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts/3TRXJ4Z8XJ8QY");
  expect(console.error).not.toHaveBeenCalled();
});

test("createPayout: a 4xx without a payout link throws and logs one line without the bearer", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(res(200, fixture("token"))).mockResolvedValueOnce(res(403, '{"name":"AUTHORIZATION_ERROR","debug_id":"d1"}')));
  await expect(realPaypal(env).createPayout({ sender_batch_id: "k", sender_item_id: "k", receiver: "s@example.com", amount_minor: 100, note: "n" }, "k"))
    .rejects.toMatchObject({ status: 403, name_: "AUTHORIZATION_ERROR", debug_id: "d1" });
  const line = String(vi.mocked(console.error).mock.calls[0]![0]);
  expect(line).toBe("paypal createPayout failed status=403 name=AUTHORIZATION_ERROR debug_id=d1");
  expect(line).not.toContain(TOKEN);
});

test("cancelPayoutItem: already cancelled resolves; cancel success resolves", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(res(200, fixture("token")))
    .mockResolvedValueOnce(res(422, fixture("payouts-item.cancel.already")))
    .mockResolvedValueOnce(res(200, fixture("payouts-item.cancel")));
  vi.stubGlobal("fetch", fetchMock);
  const pp = realPaypal(env);
  await expect(pp.cancelPayoutItem("G2A4L7B3F8JQW")).resolves.toBeUndefined();
  await expect(pp.cancelPayoutItem("G2A4L7B3F8JQW")).resolves.toBeUndefined();
  expect(fetchMock.mock.calls[1]![0]).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts-item/G2A4L7B3F8JQW/cancel");
});

// ---------- reads for reconciliation (E12) ----------

const sdkRes = (body: string) => ({ statusCode: 200, headers: {}, result: {}, body });
/** The authorization resource of the authorize-order fixture, as GET /v2/payments/authorizations/{id} answers it. */
const authResource = (patch: Record<string, unknown> = {}) => ({ ...json("authorize-order.created").purchase_units[0].payments.authorizations[0], ...patch });

test("getCapture: SDK GET capture by id, parsed like the capture answer; a 404 throws PayPalError and logs one line", async () => {
  const spy = vi.spyOn(PaymentsController.prototype, "getCapturedPayment").mockResolvedValue(sdkRes(fixture("capture.completed")) as never);
  expect(await realPaypal(env).getCapture("5KA38057EC136584R")).toEqual({ capture_id: "5KA38057EC136584R", status: "COMPLETED", reason: null });
  expect(spy).toHaveBeenCalledWith({ captureId: "5KA38057EC136584R" });
  spy.mockResolvedValue(sdkRes(fixture("capture.declined")) as never);
  expect(await realPaypal(env).getCapture("X")).toMatchObject({ status: "DECLINED", reason: "DECLINED_BY_RISK_FRAUD_FILTERS" });

  const body = '{"name":"RESOURCE_NOT_FOUND","debug_id":"d404","details":[{"issue":"INVALID_RESOURCE_ID"}]}';
  spy.mockRejectedValue(new ApiError({ request: { method: "GET", url: "u" }, response: { statusCode: 404, body, headers: {} } }, "HTTP 404"));
  await expect(realPaypal(env).getCapture("NOPE")).rejects.toMatchObject({ status: 404, name_: "INVALID_RESOURCE_ID", debug_id: "d404" });
  expect(String(vi.mocked(console.error).mock.calls.at(-1)![0])).toBe("paypal getCapture failed status=404 name=INVALID_RESOURCE_ID debug_id=d404");
});

test("getAuthorization: SDK GET authorization by id; reason only when PENDING; a body without an id throws NO_AUTHORIZATION", async () => {
  const spy = vi.spyOn(PaymentsController.prototype, "getAuthorizedPayment").mockResolvedValue(sdkRes(JSON.stringify(authResource())) as never);
  expect(await realPaypal(env).getAuthorization("66P728836U784324A")).toEqual({ authorization_id: "66P728836U784324A", status: "CREATED", expiration_time: "2026-11-18T15:57:51Z", reason: null });
  expect(spy).toHaveBeenCalledWith({ authorizationId: "66P728836U784324A" });
  spy.mockResolvedValue(sdkRes(JSON.stringify(authResource({ status: "PENDING", status_details: { reason: "PENDING_REVIEW" } }))) as never);
  expect(await realPaypal(env).getAuthorization("A")).toMatchObject({ status: "PENDING", reason: "PENDING_REVIEW" });
  spy.mockResolvedValue(sdkRes(JSON.stringify(authResource({ status: "VOIDED", status_details: { reason: "X" } }))) as never);
  expect(await realPaypal(env).getAuthorization("A")).toMatchObject({ status: "VOIDED", reason: null });
  spy.mockResolvedValue(sdkRes("{}") as never);
  await expect(realPaypal(env).getAuthorization("A")).rejects.toMatchObject({ name_: "NO_AUTHORIZATION" });
});

test("getPayoutBatch: raw GET /v1/payments/payouts/{id} with the bearer and no request id; items with sender_item_id, status, errors.name", async () => {
  const failed = json("payout.batch");
  failed.items[0] = { ...failed.items[0], transaction_status: "FAILED", errors: { name: "RECEIVER_UNREGISTERED", message: "x" } };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(res(200, fixture("token")))
    .mockResolvedValueOnce(res(200, fixture("payout.batch")))
    .mockResolvedValueOnce(res(200, JSON.stringify(failed)))
    .mockResolvedValueOnce(res(404, '{"name":"INVALID_RESOURCE_ID","debug_id":"d9"}'));
  vi.stubGlobal("fetch", fetchMock);
  const pp = realPaypal(env);
  expect(await pp.getPayoutBatch("3TRXJ4Z8XJ8QY")).toEqual({
    payout_batch_id: "3TRXJ4Z8XJ8QY", batch_status: "SUCCESS",
    items: [{ payout_item_id: "G2A4L7B3F8JQW", sender_item_id: "payout-HS-7K2Q-1", transaction_status: "SUCCESS", error_name: null }],
  });
  const [url, init] = fetchMock.mock.calls[1]! as [string, RequestInit];
  expect(url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts/3TRXJ4Z8XJ8QY");
  expect(init.method).toBe("GET");
  expect(init.body).toBeUndefined();
  expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  expect(init.headers).not.toHaveProperty("PayPal-Request-Id");
  expect((await pp.getPayoutBatch("3TRXJ4Z8XJ8QY")).items[0]).toMatchObject({ transaction_status: "FAILED", error_name: "RECEIVER_UNREGISTERED" });
  await expect(pp.getPayoutBatch("NOPE")).rejects.toMatchObject({ status: 404, name_: "INVALID_RESOURCE_ID", debug_id: "d9" });
  expect(String(vi.mocked(console.error).mock.calls.at(-1)![0])).toBe("paypal getPayoutBatch failed status=404 name=INVALID_RESOURCE_ID debug_id=d9");
});
