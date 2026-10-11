// 06 "One per command": submit_evidence (every validation bullet, the four-event trail), the D8 hash match, and the
// two-simultaneous-submit_evidence case of "Concurrency".
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { addFile, handle } from "@/lib/deal";
import { captureKey, payoutBatchId } from "@/lib/deal/keys";
import { openRaw, openText, openVerdict } from "@/lib/deal/sealed";
import type { Command } from "@/lib/deal/types";
import { assertEventsInC6, dealBuilder, dealRow, events, expectError, makeJpeg, parties, resetDb, testDeps, TRACKING, type Parties, type TestDeps, signedAccept } from "./helpers";

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

const judgeCalls = () => deps.ai.calls.filter((c) => c.job === "judge");
const submit = (code: string, cmd: Partial<Extract<Command, { type: "submit_evidence" }>>, actor = p.asSeller) =>
  handle(code, actor, { type: "submit_evidence", file_ids: [], tracking_number: TRACKING, note: null, ...cmd }, deps);

describe("submit_evidence", () => {
  test("stores evidence and verdicts, decides capture, answers the full DealView; four events in id order", async () => {
    const code = await build.held();
    const ids = await build.evidence(code, 2);
    const v = await submit(code, { file_ids: ids, note: "Shipped Monday" });

    expect(v).toMatchObject({ role: "seller", status: "captured", fix_attempts_used: 0 });
    const s = v.submissions[0]!;
    expect(v.submissions).toHaveLength(1);
    expect(s).toMatchObject({ submission_no: 1, tracking_number: TRACKING, carrier_status: "delivered", note: "Shipped Monday", decision: "capture", decision_reason: "all_pass" });
    expect(s.files.map((f) => f.id)).toEqual(ids);
    expect(s.decided_at).not.toBeNull();
    expect(s.verdicts.map((x) => x.condition_id)).toEqual(v.conditions.map((c) => c.id)); // by position
    expect(s.verdicts[0]).toMatchObject({ result: "pass", confidence: 0.95, model: "fake", prompt_version: "judge-v1", evidence_used: ["e1"] });
    expect(v.payment).toMatchObject({ status: "captured", capture_id: "CAP-1", authorization_id: "AUTH-1" });
    expect(v.payouts).toEqual([expect.objectContaining({ attempt: 1, status: "pending", sender_batch_id: payoutBatchId(code, 1), paypal_batch_id: "BATCH-1", amount_minor: 8000 })]);

    const d = await dealRow(code);
    const ev = await deps.db.evidence.findMany({ where: { deal_id: d.id }, orderBy: { position: "asc" } });
    expect(ev.map((e) => [e.submission_no, e.kind, e.position, e.file_id, e.value && openText("evidence.value", d.id, e.value)]).sort()).toEqual([
      [1, "note", 0, null, "Shipped Monday"], [1, "photo", 1, ids[0], null], [1, "photo", 2, ids[1], null], [1, "tracking", 0, null, TRACKING],
    ]);
    const rows = (await deps.db.verdict.findMany({ where: { deal_id: d.id } })).map((r) => openVerdict(d.id, r));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ submission_no: 1, model: "fake", prompt_version: "judge-v1", raw_response: expect.objectContaining({ request_id: "req_fake" }) });

    expect(judgeCalls()).toHaveLength(1);
    const input = judgeCalls()[0]!.input as { evidence_photos: { id: string }[]; carrier_status: string; submission_no: number; note: string };
    expect(input.evidence_photos.map((x) => x.id)).toEqual(ids);
    expect(input).toMatchObject({ carrier_status: "delivered", submission_no: 1, note: "Shipped Monday" });

    const trail = (await events(code)).slice(-4);
    expect(trail.map((e) => [e.from_status, e.to_status, e.actor, e.cause])).toEqual([
      ["held", "proof_submitted", "seller", "submit_evidence"],
      ["proof_submitted", "proof_submitted", "ai", "verdict"],
      ["proof_submitted", "captured", "system", "decision:capture"],
      ["captured", "captured", "paypal", "fact:capture_completed"],
    ]);
    expect(trail[0]!.payload).toEqual({ submission_no: 1, file_ids: ids, tracking_number: TRACKING, carrier_status: "delivered" });
    expect(trail[1]!.payload).toMatchObject({ submission_no: 1, model: "fake", prompt_version: "judge-v1", labels: { e1: ids[0], e2: ids[1] } });
    expect((trail[1]!.payload as { verdicts: unknown[] }).verdicts).toEqual(v.conditions.map((c) => ({ condition_id: c.id, result: "pass", confidence: 0.95 })));
    expect(trail[2]!.payload).toEqual({ submission_no: 1, reason: "all_pass", capture_id: "CAP-1", capture_status: "COMPLETED", paypal_request_id: captureKey(code, 0) });
    expect(trail[3]!.payload).toMatchObject({ capture_id: "CAP-1", source: "api", paypal_request_id: captureKey(code, 0), payout: { attempt: 1, sender_batch_id: payoutBatchId(code, 1), status: "pending" } });
  });

  test("tracking condition without a tracking number, photo condition without photos -> invalid_input; tracking-only deal accepts no photos", async () => {
    const code = await build.held();
    const ids = await build.evidence(code, 1);
    await expectError(submit(code, { file_ids: ids, tracking_number: null }), "invalid_input");
    await expectError(submit(code, { file_ids: [] }), "invalid_input");
    expect((await dealRow(code)).status).toBe("held");
    expect(judgeCalls()).toHaveLength(0);

    deps.ai.extractWith({ item_title: "Book", amount_minor: 1500, currency: "USD", deadline_days: 5, conditions: [{ text: "Tracking shows delivered", evidence_type: "tracking" }], rejected: [] });
    const trackingOnly = await build.held();
    expect((await dealRow(trackingOnly)).conditions).toHaveLength(1);
    const v = await submit(trackingOnly, { file_ids: [] });
    expect(v.status).toBe("captured");
    expect(v.submissions[0]!.files).toEqual([]);
  });

  test("7 ids -> too_many_files; another deal's file, a reference file, a used file, a duplicate -> invalid_input; note over 1000 -> invalid_input", async () => {
    const code = await build.held();
    const ids = await build.evidence(code, 6);
    const other = await build.held();
    const [foreign] = await build.evidence(other, 1, 900);
    const draft = await build.draft();
    const ref = await addFile(draft, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: makeJpeg(7) }, deps);

    await expectError(submit(code, { file_ids: [...ids, foreign!] }), "too_many_files");
    await expectError(submit(code, { file_ids: [ids[0]!, foreign!] }), "invalid_input");
    await expectError(submit(code, { file_ids: [ids[0]!, ref.id] }), "invalid_input");
    await expectError(submit(code, { file_ids: [ids[0]!, ids[0]!] }), "invalid_input");
    await expectError(submit(code, { file_ids: [ids[0]!], note: "x".repeat(1001) }), "invalid_input");
    await expectError(submit(code, { file_ids: [ids[0]!], note: "" }), "invalid_input");
    expect((await dealRow(code)).status).toBe("held");

    // a file used by submission 1 cannot be re-sent in submission 2
    deps.ai.judgeWith([{ result: "fail", confidence: 0.92, reason: "Wrong item." }]);
    expect((await submit(code, { file_ids: ids.slice(0, 2) })).status).toBe("held");
    await expectError(submit(code, { file_ids: [ids[0]!] }), "invalid_input");
    deps.ai.judgeWith([]);
    expect((await submit(code, { file_ids: ids.slice(2, 4) })).status).toBe("captured");
  });

  test("buyer -> not_a_party; not held -> invalid_state; deadline passed -> invalid_state; nothing written on a refusal", async () => {
    const agreed = await build.agreed();
    await expectError(submit(agreed, { file_ids: [] }), "invalid_state");
    const code = await build.held();
    const ids = await build.evidence(code, 1);
    await expectError(submit(code, { file_ids: ids }, p.asBuyer), "not_a_party");
    await expectError(submit(code, { file_ids: ids }, p.asThird), "not_a_party");
    const n = (await events(code)).length;
    deps.clock.set("2026-10-27T10:00:00Z"); // deadline_at exactly: not before it
    const e = await expectError(submit(code, { file_ids: ids }), "invalid_state");
    expect(e.message).toBe("The deadline has passed");
    await expectError(addFile(code, p.asSeller, { purpose: "evidence", mime: "image/jpeg", bytes: makeJpeg(3) }, deps), "invalid_state");
    expect(await events(code)).toHaveLength(n);
    expect(await deps.db.evidence.count()).toBe(0);
  });

  test("D8: an evidence photo byte-identical to a reference photo fails every photo condition at confidence 1 without a model call", async () => {
    const code = await build.draft();
    const ref = await addFile(code, p.asBuyer, { purpose: "reference", mime: "image/jpeg", bytes: makeJpeg(1) }, deps);
    await handle(code, p.asSeller, { type: "join" }, deps);
    await handle(code, p.asSeller, await signedAccept(code, p.asSeller, 1), deps);
    await handle(code, p.asBuyer, await signedAccept(code, p.asBuyer, 1), deps);
    const v0 = await handle(code, p.asBuyer, { type: "start_payment" }, deps);
    await handle(code, p.asBuyer, { type: "confirm_approval", order_id: v0.payment!.paypal_order_id }, deps);
    const copy = await addFile(code, p.asSeller, { purpose: "evidence", mime: "image/jpeg", bytes: makeJpeg(1) }, deps);
    const fresh = await addFile(code, p.asSeller, { purpose: "evidence", mime: "image/jpeg", bytes: makeJpeg(2) }, deps);
    expect(copy.sha256).toBe(ref.sha256);

    const v = await submit(code, { file_ids: [fresh.id, copy.id] }); // labels follow upload order, not the order of file_ids: the copy is e1
    expect(v).toMatchObject({ status: "held", fix_attempts_used: 1 });
    expect(judgeCalls()).toHaveLength(0);
    const s = v.submissions[0]!;
    expect(s).toMatchObject({ decision: "request_fix", decision_reason: "fail" });
    expect(s.files.map((f) => f.id)).toEqual([copy.id, fresh.id]);
    expect(s.verdicts.map((x) => [x.result, x.confidence, x.model, x.prompt_version])).toEqual([
      ["fail", 1, "none", "guardrail-v1"], ["unclear", 0, "none", "guardrail-v1"], ["fail", 1, "none", "guardrail-v1"],
    ]);
    expect(s.verdicts[0]).toMatchObject({ reason: "Evidence photo e1 is the same file as listing photo r1; a listing photo is not proof.", evidence_used: ["e1", "r1"] });
    expect(s.verdicts[1]!.reason).toBe("Not judged: the submission was rejected before the AI was called.");
    const row = await deps.db.verdict.findFirst({ where: { deal: { public_code: code } } });
    expect(openRaw(row!.deal_id, row!.raw_response)).toEqual({ skipped: "hash_match", matches: [{ evidence: "e1", reference: "r1", sha256: ref.sha256 }], latency_ms: 0 });
    expect((await events(code)).find((e) => e.cause === "verdict")!.payload).toMatchObject({ model: "none", prompt_version: "guardrail-v1", labels: { r1: ref.id, e1: copy.id, e2: fresh.id } });
  });

  test("concurrency: two simultaneous submit_evidence -> one 200 and one invalid_state, one submission, one judge call", async () => {
    const code = await build.held();
    const ids = await build.evidence(code, 4);
    const results = await Promise.allSettled([submit(code, { file_ids: ids.slice(0, 2) }), submit(code, { file_ids: ids.slice(2, 4) })]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0]!.reason as { code: string }).code).toBe("invalid_state");
    expect(judgeCalls()).toHaveLength(1);
    const ev = await deps.db.evidence.findMany({ where: { deal: { public_code: code } }, select: { submission_no: true, kind: true } });
    expect(ev).toHaveLength(3); // two photos and one tracking row, all submission 1
    expect(new Set(ev.map((e) => e.submission_no))).toEqual(new Set([1]));
    expect((await dealRow(code)).status).toBe("captured");
  });
});
