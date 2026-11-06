// Seed (03 "Seed"; decisions F3, F6): the two demo personas, upserted on every run, and 25 historical deals written
// once (skipped when any deals.seeded row exists). Events only, no PayPal objects, no photos: conditions and verdicts
// are enough for the deal page, the ledger and the dashboard. Contract text is sealed like any deal's (trust spec §5).
// Run: npm run seed (tsx prisma/seed.ts).
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";
import { newPublicCode } from "../lib/deal/code";
import { sealPayload, sealRaw, sealText } from "../lib/deal/sealed";
import { CODE_CONDITION } from "../lib/deal/terms";
import { contractDocOf, hashOf } from "../lib/deal/contract";
import { limitsFromEnv } from "../lib/deal/decide";
import { signingMessage } from "../lib/contract/canonical";
import { bytesToB64url, fingerprint } from "../lib/contract/signature";
import type { DealStatus, EventActor, VerdictResult } from "../lib/deal/types";

type Db = Pick<PrismaClient, "user" | "deal" | "signingKey" | "$transaction">;

type Ev = { from_status: DealStatus | null; to_status: DealStatus; actor: EventActor; cause: string; payload: Prisma.InputJsonObject; created_at: Date };
type Row = { result: VerdictResult; confidence: number; reason: string };
type VerdictSpec = { submission_no: 1 | 2; rows: Row[]; created_at: Date };

type Kind =
  | "draft" | "draft_joined" | "terms_agreed" | "held"
  | "in_review_limit" | "in_review_unclear" | "captured_payout_failed"
  | "paid" | "paid_fix" | "paid_review"
  | "voided_cancel" | "voided_deadline" | "voided_fix" | "voided_reject";

// [kind, item, amount_minor, deadline_days, age in days]: the 03 distribution (draft 3, terms_agreed 2, held 4,
// in_review 2, captured 2, paid 8, voided 4), amounts 1,500 to 45,000, ages spread over 60 days.
const DEALS: [Kind, string, number, number, number][] = [
  ["paid", "blue ceramic mug", 1800, 5, 59], ["paid", "wooden desk lamp", 3500, 7, 55], ["voided_cancel", "board game", 2400, 5, 53],
  ["paid_fix", "stainless steel water bottle", 2200, 7, 50], ["paid_review", "mirrorless camera lens", 45000, 10, 47], ["paid", "denim jacket", 6500, 5, 44],
  ["captured_payout_failed", "wireless headphones", 9900, 7, 41], ["voided_deadline", "vintage record player", 15000, 7, 38],
  ["paid_review", "road bicycle", 32000, 14, 32], ["voided_fix", "leather satchel", 7200, 7, 29], ["paid_fix", "cast iron skillet", 4100, 5, 26],
  ["paid", "mechanical keyboard", 12500, 7, 23], ["captured_payout_failed", "acoustic guitar", 19900, 14, 20], ["voided_reject", "standing desk mat", 1500, 3, 17],
  ["in_review_limit", "electric scooter", 42000, 14, 11], ["in_review_unclear", "chess set", 5600, 5, 9],
  ["held", "linen tablecloth", 3900, 7, 6], ["held", "robot vacuum", 19000, 10, 5], ["held", "bluetooth speaker", 7400, 7, 4],
  ["held", "ceramic plant pot", 2900, 5, 3], ["terms_agreed", "winter coat", 11000, 7, 2], ["terms_agreed", "yoga mat", 2600, 3, 2],
  ["draft_joined", "reading lamp", 4500, 5, 1], ["draft", "garden hose", 3100, 5, 1], ["draft", "picture frame", 1900, 3, 0],
];

const PASS: Record<string, string> = {
  "Item matches the listing photos": "The photos match the listing.",
  "Original box is included": "The original box is visible in the photos.",
  "Tracking shows delivered": "The carrier reports the parcel as delivered.",
};
const PASS_CODE = "The deal code is legible in the photo.";
const FAIL = "The item in the photo does not match the listing.";
const UNCLEAR = "The photo is too blurry to compare with the listing.";

const conditionsFor = (i: number, code: string): { id: string; position: number; text: string; evidence_type: "photo" | "tracking" }[] => {
  const own: [string, "photo" | "tracking"][] =
    i % 3 === 0 ? [["Item matches the listing photos", "photo"], ["Tracking shows delivered", "tracking"]]
    : i % 3 === 1 ? [["Item matches the listing photos", "photo"], ["Original box is included", "photo"], ["Tracking shows delivered", "tracking"]]
    : [["Item matches the listing photos", "photo"]];
  return [...own, [CODE_CONDITION(code), "photo"] as [string, "photo"]].map(([text, evidence_type], k) => ({ id: crypto.randomUUID(), position: k + 1, text, evidence_type }));
};

/** Walks one deal's path; from_status chains from the previous to_status (C2) and time advances per step. */
function trail(kind: Kind, start: Date, deal: { seller_id: string; amount_minor: number; deadline_days: number; source_text: string; conditions: { id: string; text: string }[] }) {
  const events: Ev[] = [];
  const verdicts: VerdictSpec[] = [];
  let at = start;
  let deadline_at: Date | null = null;
  const step = (cause: string, actor: EventActor, to: DealStatus, payload: Prisma.InputJsonObject = {}, afterMin = 90) => {
    at = new Date(at.getTime() + afterMin * 60_000);
    events.push({ from_status: events.at(-1)?.to_status ?? null, to_status: to, actor, cause, payload: { seeded: true, ...payload }, created_at: at });
  };
  const done = () => ({ events, verdicts, deadline_at, status: events.at(-1)!.to_status });
  const judge = (no: 1 | 2, rows: Row[]) => {
    step("submit_evidence", "seller", "proof_submitted", { submission_no: no, file_ids: [], tracking_number: "TRK-DEMO-0000", carrier_status: "delivered" }, 2 * 24 * 60);
    const vs = deal.conditions.map(({ id: condition_id }, k) => ({ condition_id, result: rows[k].result, confidence: rows[k].confidence }));
    step("verdict", "ai", "proof_submitted", { submission_no: no, model: "seed", prompt_version: "judge-v1", verdicts: vs }, 1);
    verdicts.push({ submission_no: no, rows, created_at: at });
  };
  const allPass = (seedConf: number) => deal.conditions.map((c, k) => ({ result: "pass" as const, confidence: Math.round((0.86 + ((seedConf + k * 3) % 13) / 100) * 100) / 100, reason: PASS[c.text] ?? PASS_CODE }));
  const oneFail = () => allPass(5).map((r, k) => (k === 0 ? { result: "fail" as const, confidence: 0.93, reason: FAIL } : r));
  const oneUnclear = () => allPass(2).map((r, k) => (k === 0 ? { result: "unclear" as const, confidence: 0.55, reason: UNCLEAR } : r));
  const paidTail = () => {
    step("fact:capture_completed", "paypal", "captured", { payout: { attempt: 1 } }, 2);
    step("fact:payout_succeeded", "paypal", "paid", { attempt: 1 }, 5);
  };

  step("create", "buyer", "draft", { source_text: deal.source_text, model: "seed", prompt_version: "extract-v1", rejected: [] }, 0);
  if (kind === "draft") return done();
  step("join", "seller", "draft", { seller_id: deal.seller_id });
  step("accept", "buyer", "draft", { terms_version: 1 });
  if (kind === "draft_joined") return done();
  step("accept", "seller", "terms_agreed", { terms_version: 1 });
  if (kind === "terms_agreed") return done();
  if (kind === "voided_cancel") {
    step("cancel", "buyer", "voided", { voided: false }, 6 * 60);
    return done();
  }
  step("start_payment", "buyer", "terms_agreed", { order_attempt: 1 });
  deadline_at = new Date(at.getTime() + 10 * 60_000 + deal.deadline_days * 24 * 60 * 60_000);
  step("fact:authorization_created", "paypal", "held", { auth_expires_at: new Date(at.getTime() + 10 * 60_000 + 29 * 24 * 60 * 60_000).toISOString() }, 10);
  switch (kind) {
    case "held": break;
    case "voided_deadline": step("tick:deadline", "system", "voided", { deadline_at: deadline_at.toISOString() }, deal.deadline_days * 24 * 60 + 30); break;
    case "in_review_limit": judge(1, allPass(1)); step("decision:buyer_review", "system", "in_review", { submission_no: 1, reason: "amount_over_limit" }, 1); break;
    case "in_review_unclear": judge(1, oneUnclear()); step("decision:buyer_review", "system", "in_review", { submission_no: 1, reason: "unclear" }, 1); break;
    case "voided_reject":
      judge(1, oneUnclear()); step("decision:buyer_review", "system", "in_review", { submission_no: 1, reason: "unclear" }, 1);
      step("review:reject", "buyer", "voided", { note: "The photo does not show my item." }, 5 * 60); break;
    case "paid_review":
      judge(1, allPass(3)); step("decision:buyer_review", "system", "in_review", { submission_no: 1, reason: "amount_over_limit" }, 1);
      step("review:approve", "buyer", "captured", { note: "Looks right, releasing." }, 4 * 60); paidTail(); break;
    case "captured_payout_failed":
      judge(1, allPass(4)); step("decision:capture", "system", "captured", { submission_no: 1 }, 1);
      step("fact:capture_completed", "paypal", "captured", { payout: { attempt: 1 } }, 2);
      step("fact:payout_failed", "paypal", "captured", { attempt: 1, failure_reason: "RECEIVER_UNREGISTERED" }, 5); break;
    case "paid": judge(1, allPass(6)); step("decision:capture", "system", "captured", { submission_no: 1 }, 1); paidTail(); break;
    case "paid_fix":
      judge(1, oneFail()); step("decision:request_fix", "system", "held", { submission_no: 1 }, 1);
      judge(2, allPass(7)); step("decision:capture", "system", "captured", { submission_no: 2 }, 1); paidTail(); break;
    case "voided_fix":
      judge(1, oneFail()); step("decision:request_fix", "system", "held", { submission_no: 1 }, 1);
      judge(2, oneFail()); step("decision:void", "system", "voided", { submission_no: 2 }, 1); break;
  }
  return done();
}

/** Upserts the personas every run; writes the historical deals only when none exist. Returns the counts. */
export async function seed(db: Db, now = new Date()): Promise<{ users: number; deals: number }> {
  const buyer = await db.user.upsert({
    where: { email: "demo-buyer@handshake.demo" },
    update: { display_name: "Demo Buyer" },
    create: { email: "demo-buyer@handshake.demo", display_name: "Demo Buyer" },
  });
  const paypal_email = process.env.DEMO_SELLER_PAYPAL_EMAIL || null;
  const paypal_email_verified_at = paypal_email ? new Date() : null; // the sandbox seller account (trust spec §8)
  const seller = await db.user.upsert({
    where: { email: "demo-seller@handshake.demo" },
    update: { display_name: "Demo Seller", paypal_email, paypal_email_verified_at },
    create: { email: "demo-seller@handshake.demo", display_name: "Demo Seller", paypal_email, paypal_email_verified_at },
  });

  const existing = await db.deal.count({ where: { seeded: true } });
  if (existing) {
    console.log(`seed: ${existing} historical deals already present, skipping`);
    return { users: 2, deals: existing };
  }

  // trust spec §6: the sample deals carry real signatures, made here with one key per persona that exists only for this run.
  const signer = async (userId: string) => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const pk = { x: jwk.x!, y: jwk.y! };
    const key = await db.signingKey.create({ data: { user_id: userId, fingerprint: await fingerprint(pk), x: pk.x, y: pk.y, label: "Seed key (sample deals)", created_at: now } });
    return { key, sign: async (hash: string) => bytesToB64url(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(signingMessage(hash)))) };
  };
  const signers = { buyer: await signer(buyer.id), seller: await signer(seller.id) };

  const limits = limitsFromEnv();
  const rule = { rule_pass_threshold: limits.passThreshold, rule_auto_capture_max_minor: limits.autoCaptureMaxMinor };
  await db.$transaction(async (tx) => {
    for (const [i, [kind, item, amount_minor, deadline_days, age]] of DEALS.entries()) {
      let public_code = newPublicCode();
      while (await tx.deal.findUnique({ where: { public_code } })) public_code = newPublicCode();
      const conditions = conditionsFor(i, public_code);
      const source_text = `I'll pay $${(amount_minor / 100).toFixed(amount_minor % 100 ? 2 : 0)} for the ${item} if it arrives within ${deadline_days} days, matches the listing photos and tracking shows delivered`;
      const start = new Date(now.getTime() - age * 24 * 60 * 60_000 - 9 * 60 * 60_000);
      const t = trail(kind, start, { seller_id: seller.id, amount_minor, deadline_days, source_text, conditions });
      const item_title = item[0]!.toUpperCase() + item.slice(1);
      const joined = kind !== "draft";
      const agreed = joined && kind !== "draft_joined";
      const id = crypto.randomUUID(); // the AAD needs the deal id before the insert
      await tx.deal.create({
        data: {
          id, public_code, seeded: true, ...rule, buyer_id: buyer.id, seller_id: joined ? seller.id : null,
          status: t.status, source_text: sealText("deals.source_text", id, source_text), item_title: sealText("deals.item_title", id, item_title),
          amount_minor, deadline_days, deadline_at: t.deadline_at,
          terms_version: 1, buyer_accepted_version: joined ? 1 : null, seller_accepted_version: agreed ? 1 : null,
          fix_attempts_used: t.verdicts.length === 2 ? 1 : 0,
          created_at: t.events[0].created_at, updated_at: t.events.at(-1)!.created_at,
          conditions: { create: conditions.map((c) => ({ ...c, text: sealText("conditions.text", id, c.text) })) },
        },
      });
      await tx.dealEvent.createMany({ data: t.events.map((e) => ({ deal_id: id, ...e, payload: sealPayload(id, e.payload) })) });
      if (joined) {
        const doc = contractDocOf({ public_code, terms_version: 1, item_title, amount_minor, deadline_days, conditions, buyer, seller, files: [], ...rule })!;
        const hash = hashOf(doc);
        for (const e of t.events.filter((x) => x.cause === "accept")) {
          const role = e.actor as "buyer" | "seller";
          await tx.contractSignature.create({
            data: { deal_id: id, user_id: role === "buyer" ? buyer.id : seller.id, role, terms_version: 1, contract_hash: hash, key_id: signers[role].key.id, signature: await signers[role].sign(hash), signed_at: e.created_at },
          });
        }
      }
      await tx.verdict.createMany({
        data: t.verdicts.flatMap((v) => v.rows.map((r, k) => ({
          deal_id: id, condition_id: conditions[k].id, submission_no: v.submission_no, ...r, reason: sealText("verdicts.reason", id, r.reason),
          evidence_used: [], model: "seed", prompt_version: "judge-v1", raw_response: sealRaw(id, { seeded: true }), created_at: v.created_at,
        }))),
      });
    }
  }, { timeout: 60_000 });
  console.log(`seed: wrote ${DEALS.length} historical deals`);
  return { users: 2, deals: DEALS.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.loadEnvFile(); } catch {} // .env is optional; Render and CI inject env vars
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, options: "-c timezone=UTC" }) });
  seed(prisma).finally(() => prisma.$disconnect());
}
