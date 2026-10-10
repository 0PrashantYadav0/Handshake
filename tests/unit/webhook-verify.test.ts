// E6 webhook signature (06 "Webhook signature (E6) against a recorded fixture"; 02 section 10 "Webhook cert fetcher").
// A generated RSA key pair signs synthetic events so the suite runs before the W1 spike records real fixtures; the
// recorded PAYMENT.CAPTURE.COMPLETED.1.json + cert.pem block below switches on by itself once those files exist.
import { createSign, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearCertCache, crc32Decimal, verifyPaypalSignature } from "@/lib/paypal/verify";

const FIXTURES = join(__dirname, "..", "fixtures", "webhooks");
const CERT_URL = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST";
const WEBHOOK_ID = "WH-CONFIGURED";
const BODY = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP-1", "status":"COMPLETED"}}';

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }) as string;

function sign(body: string, webhookId = WEBHOOK_ID, certUrl = CERT_URL) {
  const id = "tx-1";
  const time = "2026-10-10T12:00:00Z";
  const sig = createSign("SHA256").update(`${id}|${time}|${webhookId}|${crc32Decimal(body)}`).sign(privateKey, "base64");
  return {
    "paypal-transmission-id": id,
    "paypal-transmission-time": time,
    "paypal-transmission-sig": sig,
    "paypal-cert-url": certUrl,
    "paypal-auth-algo": "SHA256withRSA",
  };
}

const fetchCert = vi.fn(async () => pem);
const verify = (headers: Record<string, string | null>, rawBody = BODY, webhookId: string | null = WEBHOOK_ID) =>
  verifyPaypalSignature({ headers, rawBody, webhookId, fetchCert });

beforeEach(() => { clearCertCache(); fetchCert.mockClear(); });
afterEach(() => vi.unstubAllEnvs());

test("crc32 from node:zlib is PayPal's unsigned decimal", () => {
  expect(crc32Decimal("hello")).toBe("907060870");
});

test("valid signature verifies and reports the webhook id", async () => {
  await expect(verify(sign(BODY))).resolves.toEqual({ result: "verified", webhook_id: WEBHOOK_ID });
});

test("header names are matched case-insensitively", async () => {
  const upper = Object.fromEntries(Object.entries(sign(BODY)).map(([k, v]) => [k.toUpperCase(), v]));
  await expect(verify(upper)).resolves.toMatchObject({ result: "verified" });
});

test("one byte changed, re-serialised JSON, different webhook id: unverified", async () => {
  const headers = sign(BODY);
  await expect(verify(headers, BODY.replace("CAP-1", "CAP-2"))).resolves.toMatchObject({ result: "unverified" });
  await expect(verify(headers, JSON.stringify(JSON.parse(BODY)))).resolves.toMatchObject({ result: "unverified" });
  await expect(verify(headers, BODY, "WH-OTHER")).resolves.toMatchObject({ result: "unverified" });
});

test("WEBHOOK_ID (simulator) verifies outside production only", async () => {
  const headers = sign(BODY, "WEBHOOK_ID");
  await expect(verify(headers)).resolves.toEqual({ result: "verified", webhook_id: "WEBHOOK_ID" });
  vi.stubEnv("NODE_ENV", "production");
  await expect(verify(headers)).resolves.toMatchObject({ result: "unverified" });
  await expect(verify(headers, BODY, "WEBHOOK_ID")).resolves.toMatchObject({ result: "unverified" });
});

test.each([
  "https://evil.example/paypal.com/cert",
  "https://api.sandbox.paypal.com.evil.example/x",
  "http://api.sandbox.paypal.com/x",
  "not a url",
])("cert url %s is rejected before the cert is fetched", async (url) => {
  await expect(verify(sign(BODY, WEBHOOK_ID, url))).resolves.toMatchObject({ result: "unverified" });
  expect(fetchCert).not.toHaveBeenCalled();
});

test("the cert is fetched once for two verifications of the same url", async () => {
  await verify(sign(BODY));
  await verify(sign(BODY));
  expect(fetchCert).toHaveBeenCalledTimes(1);
});

test("fetchCert throwing is fetch_failed, not unverified, and is not cached", async () => {
  fetchCert.mockRejectedValueOnce(new Error("timeout"));
  await expect(verify(sign(BODY))).resolves.toEqual({ result: "fetch_failed", webhook_id: null });
  await expect(verify(sign(BODY))).resolves.toMatchObject({ result: "verified" });
});

test("missing header, wrong algo, bad base64 and a garbage cert never throw", async () => {
  await expect(verify({ ...sign(BODY), "paypal-transmission-sig": null })).resolves.toMatchObject({ result: "unverified" });
  await expect(verify({ ...sign(BODY), "paypal-auth-algo": "HS256" })).resolves.toMatchObject({ result: "unverified" });
  await expect(verify({ ...sign(BODY), "paypal-transmission-sig": "!!not base64!!" })).resolves.toMatchObject({ result: "unverified" });
  expect(fetchCert).toHaveBeenCalledTimes(1); // only the bad-base64 case reached the cert
  clearCertCache();
  fetchCert.mockResolvedValueOnce("not a pem");
  await expect(verify(sign(BODY))).resolves.toMatchObject({ result: "unverified" });
});

// Recorded by scripts/sandbox/record-webhook.ts during the W1 spike (T-12). Skipped until the files exist.
const RECORDED = join(FIXTURES, "PAYMENT.CAPTURE.COMPLETED.1.json");
const CERT = join(FIXTURES, "cert.pem");
describe.skipIf(!existsSync(RECORDED) || !existsSync(CERT))("recorded PAYMENT.CAPTURE.COMPLETED fixture", () => {
  test("recorded headers, body and webhook id verify; any change does not", async () => {
    const rec = JSON.parse(readFileSync(RECORDED, "utf8")) as {
      webhook_id: string; headers: Record<string, string>; raw_body: string;
    };
    const fromDisk = vi.fn(async () => readFileSync(CERT, "utf8"));
    const run = (rawBody = rec.raw_body, webhookId = rec.webhook_id) =>
      verifyPaypalSignature({ headers: rec.headers, rawBody, webhookId, fetchCert: fromDisk });
    await expect(run()).resolves.toEqual({ result: "verified", webhook_id: rec.webhook_id });
    await expect(run(rec.raw_body.replace("COMPLETED", "COMPLETEX"))).resolves.toMatchObject({ result: "unverified" });
    await expect(run(JSON.stringify(JSON.parse(rec.raw_body)))).resolves.toMatchObject({ result: "unverified" });
    await expect(run(rec.raw_body, "WH-OTHER")).resolves.toMatchObject({ result: "unverified" });
    expect(fromDisk).toHaveBeenCalledTimes(1);
  });
});
