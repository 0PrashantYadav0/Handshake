// 06 "Receiver behaviour" (E6; 02 section 6.8; 04 section 11) through the exported POST with a raw JSON string and the five
// PAYPAL-* headers, SB-7 through the route, and 06 "One per command" tick (the bearer check; 04 section 12).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as tickRoute } from "@/app/api/jobs/tick/route";
import { POST as webhook } from "@/app/api/webhooks/paypal/route";
import { overrideDeps } from "@/lib/deps";
import type { DealStatus, EventActor } from "@/lib/deal/types";
import { assertEventsInC6, callRoute, dealBuilder, dealRow, events, parties, resetDb, testDeps, type Parties, type TestDeps } from "./helpers";

let deps: TestDeps;
let p: Parties;
let build: ReturnType<typeof dealBuilder>;
let n = 0;

beforeEach(async () => {
  await resetDb();
  deps = testDeps();
  p = await parties();
  build = dealBuilder(deps, p);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await assertEventsInC6();
});

const PAYPAL_HEADERS = {
  "paypal-transmission-id": "tx-1", "paypal-transmission-time": "2026-10-20T10:00:00Z", "paypal-transmission-sig": "c2ln",
  "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem", "paypal-auth-algo": "SHA256withRSA",
};
const captureEvent = (code: string) => ({ id: `WHR-${++n}`, event_type: "PAYMENT.CAPTURE.COMPLETED", create_time: "2026-10-20T10:00:00Z", resource_type: "capture", resource: { id: `CAP-${code}`, custom_id: code } });
const deliver = (body: unknown) => callRoute(webhook, "POST", "/api/webhooks/paypal", { body: typeof body === "string" ? body : JSON.stringify(body), headers: PAYPAL_HEADERS });
const errorCode = async (res: Response) => (await res.json()).error.code;
const whRow = (id: string) => deps.db.webhookEvent.findUnique({ where: { paypal_event_id: id } });
const facts = async (code: string) => (await events(code)).filter((e) => e.cause === "fact:capture_completed");

/** A status T-10 reaches by command, written as its C6 transition (the pattern of webhooks.int.test.ts). */
async function moveTo(code: string, to: DealStatus, cause: string, actor: EventActor): Promise<void> {
  const d = await dealRow(code);
  await deps.db.deal.update({ where: { id: d.id }, data: { status: to } });
  await deps.db.dealEvent.create({ data: { deal_id: d.id, from_status: d.status, to_status: to, actor, cause, payload: {} } });
}
const proofSubmitted = async () => { const code = await build.held(); await moveTo(code, "proof_submitted", "submit_evidence", "seller"); return code; };

describe("POST /api/webhooks/paypal", () => {
  test("new verified event -> 200 applied, row verified with processed_at set, deal captured with one payout; same id again -> 200 already_processed, one row, one fact, one payout (SB-7)", async () => {
    const code = await proofSubmitted();
    const e = captureEvent(code);
    const first = await deliver(e);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, outcome: "applied" });
    expect(await whRow(e.id)).toMatchObject({ verified: true, event_type: "PAYMENT.CAPTURE.COMPLETED", last_error: null });
    expect((await whRow(e.id))!.processed_at).not.toBeNull();
    expect(deps.paypal.calls.find((c) => c.op === "verifyWebhook")).toMatchObject({ args: { rawBody: JSON.stringify(e), headers: PAYPAL_HEADERS } }); // the raw text, verified before parsing

    const again = await deliver(e);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, outcome: "already_processed" });
    expect(await deps.db.webhookEvent.count()).toBe(1);
    const row = await dealRow(code);
    expect(row.status).toBe("captured");
    expect(row.payouts).toHaveLength(1);
    expect(await facts(code)).toHaveLength(1);
    expect(deps.paypal.calls.filter((c) => c.op === "createPayout")).toHaveLength(1);
  });

  test("bad signature -> 400 invalid_input, row stored verified = false and unprocessed, deal untouched", async () => {
    const code = await proofSubmitted();
    const e = captureEvent(code);
    deps.paypal.failNext("verifyWebhook", "timeout");
    const res = await deliver(e);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_input");
    expect(await whRow(e.id)).toMatchObject({ verified: false, processed_at: null });
    expect((await dealRow(code)).status).toBe("proof_submitted");
    expect(await facts(code)).toHaveLength(0);
  });

  test("processing throws -> 500 internal_error with processed_at null; the redelivery -> 200 applied and exactly one payout", async () => {
    const code = await proofSubmitted();
    const e = captureEvent(code);
    vi.spyOn(deps.db, "$transaction").mockRejectedValueOnce(new Error("db down"));
    const res = await deliver(e);
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe("internal_error");
    expect(await whRow(e.id)).toMatchObject({ verified: true, processed_at: null, last_error: "db down" });
    expect((await dealRow(code)).payouts).toHaveLength(0);

    const again = await deliver(e);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, outcome: "applied" });
    expect((await whRow(e.id))!.processed_at).not.toBeNull();
    const row = await dealRow(code);
    expect(row.status).toBe("captured");
    expect(row.payouts).toHaveLength(1);
    expect(await facts(code)).toHaveLength(1);
    expect(deps.paypal.calls.filter((c) => c.op === "createPayout")).toHaveLength(1);
  });

  test("non-JSON body -> 400 invalid_input, nothing stored; a JSON body without a string id -> 400, nothing stored", async () => {
    for (const body of ["not json {", JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED" })]) {
      const res = await deliver(body);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("invalid_input");
    }
    expect(await deps.db.webhookEvent.count()).toBe(0);
  });

  test("cert fetch failed -> 500 internal_error and nothing stored", async () => {
    const code = await proofSubmitted();
    overrideDeps({ paypal: { ...deps.paypal, verifyWebhook: async () => ({ result: "fetch_failed", webhook_id: null }) } });
    const res = await deliver(captureEvent(code));
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe("internal_error");
    expect(await deps.db.webhookEvent.count()).toBe(0);
    expect((await dealRow(code)).status).toBe("proof_submitted");
  });

  test("verified event for no deal -> 200 unknown_deal, stored and processed", async () => {
    const e = captureEvent("HS-NONE");
    const res = await deliver(e);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "unknown_deal" });
    expect((await whRow(e.id))!.processed_at).not.toBeNull();
  });
});

describe("POST /api/jobs/tick", () => {
  const SECRET = "c".repeat(44);
  const call = (authorization?: string) => callRoute(tickRoute, "POST", "/api/jobs/tick", { headers: authorization ? { authorization } : {} });

  test("no header, wrong token or wrong length -> 401 not_signed_in; nothing voided", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const code = await build.held();
    deps.clock.set("2026-10-27T10:00:01Z"); // deadline_at 2026-10-27T10:00:00Z for a deal held at CLOCK_START
    for (const auth of [undefined, `Bearer ${"d".repeat(44)}`, `Bearer ${SECRET.slice(1)}`, SECRET]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe("not_signed_in");
    }
    expect((await dealRow(code)).status).toBe("held");
  });

  test("right token -> 200 TickReport; one overdue held deal is voided", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const code = await build.held();
    deps.clock.set("2026-10-27T10:00:01Z");
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voided: [code], verdicts_rerun: [], reconciled: [], errors: [] });
    expect((await dealRow(code)).status).toBe("voided");
    expect(await (await call(`Bearer ${SECRET}`)).json()).toEqual({ voided: [], verdicts_rerun: [], reconciled: [], errors: [] });
  });
});
