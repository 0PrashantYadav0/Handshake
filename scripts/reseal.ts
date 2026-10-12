// npm run reseal (trust spec §5, key rotation): re-seals every sealed column with the active DATA_KEYS key. Deals are read in
// batches of 100 and each deal is re-sealed in its own transaction under the deal row lock. Idempotent: a value already on the
// active kid is left alone. deal_events is append-only (03 constraints trigger), so event payloads keep the kid they were written
// with; the run lists those kids, and they must stay in DATA_KEYS while such events exist.
// Plaintext (rows written before encryption, review finding 2) is sealed as is. Plaintext event payloads are sealed only with
// --seal-plaintext-events, which lifts the append-only trigger inside one transaction for that single rewrite.
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";
import { isSealed, keyring } from "../lib/crypto/seal";
import { EVENT_SEALED_JSON_KEYS, EVENT_SEALED_KEYS, openFile, openRaw, openText, sealFile, sealPayload, sealRaw, sealText } from "../lib/deal/sealed";
import { lockDeal } from "../lib/deal/transition";

type Db = Pick<PrismaClient, "deal" | "dealEvent" | "$transaction">;
type Tx = Prisma.TransactionClient;

const BATCH = 100;
/** The kid inside a sealed value; the full open below still authenticates it. */
const sealedBytes = (v: Uint8Array) => v[0] === 0x45 && v[1] === 0x31;
const kidOf = (v: string | Uint8Array) =>
  typeof v === "string" ? (isSealed(v) ? v.split(".")[1] : undefined) : sealedBytes(v) ? Buffer.from(v.subarray(3, 3 + (v[2] ?? 0))).toString("ascii") : undefined;

/** Re-seals one deal's stale values; returns how many it rewrote. */
async function resealDeal(tx: Tx, id: string, stale: (v: string | Uint8Array) => boolean): Promise<number> {
  await lockDeal(tx, id);
  const d = await tx.deal.findUniqueOrThrow({
    where: { id },
    select: {
      source_text: true, item_title: true, updated_at: true,
      conditions: { select: { id: true, text: true } },
      evidence: { select: { id: true, value: true } },
      files: { select: { id: true, bytes: true } },
      verdicts: { select: { id: true, reason: true, raw_response: true } },
    },
  });
  let n = 0;
  const text = (col: Parameters<typeof sealText>[0], v: string) => {
    n++;
    return sealText(col, id, isSealed(v) ? openText(col, id, v) : v); // plaintext from before encryption is sealed as is
  };

  const deal: Prisma.DealUpdateInput = {};
  if (stale(d.source_text)) deal.source_text = text("deals.source_text", d.source_text);
  if (stale(d.item_title)) deal.item_title = text("deals.item_title", d.item_title);
  if (n) await tx.deal.update({ where: { id }, data: { ...deal, updated_at: d.updated_at } }); // a rotation is not a deal change
  for (const c of d.conditions) if (stale(c.text)) await tx.condition.update({ where: { id: c.id }, data: { text: text("conditions.text", c.text) } });
  for (const e of d.evidence) if (e.value !== null && stale(e.value)) await tx.evidence.update({ where: { id: e.id }, data: { value: text("evidence.value", e.value) } });
  for (const f of d.files) {
    if (!stale(f.bytes)) continue;
    n++;
    await tx.file.update({ where: { id: f.id }, data: { bytes: sealFile(id, sealedBytes(f.bytes) ? openFile(id, f.bytes) : f.bytes) } });
  }
  for (const v of d.verdicts) {
    const data: Prisma.VerdictUpdateInput = {};
    if (stale(v.reason)) data.reason = text("verdicts.reason", v.reason);
    const raw = (v.raw_response as { sealed?: string } | null)?.sealed;
    if (raw === undefined || stale(raw)) {
      n++;
      data.raw_response = sealRaw(id, raw === undefined ? v.raw_response : openRaw(id, v.raw_response)); // no { sealed }: plaintext JSON
    }
    if (Object.keys(data).length) await tx.verdict.update({ where: { id: v.id }, data });
  }
  return n;
}

/** One transaction: lift the append-only trigger, seal plaintext payload keys, restore the trigger. Returns events rewritten. */
async function sealPlaintextEvents(db: Db): Promise<number> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE "deal_events" DISABLE TRIGGER "deal_events_no_update_delete"`);
    let n = 0;
    const rows = await tx.dealEvent.findMany({ select: { id: true, deal_id: true, payload: true } });
    for (const e of rows) {
      const p = e.payload as Record<string, unknown>;
      const plain = EVENT_SEALED_KEYS.some((k) => typeof p[k] === "string" && !isSealed(p[k] as string)) || EVENT_SEALED_JSON_KEYS.some((k) => p[k] !== undefined && typeof p[k] !== "string");
      if (!plain) continue;
      const sealedKeys: readonly string[] = [...EVENT_SEALED_KEYS, ...EVENT_SEALED_JSON_KEYS];
      const keep = Object.fromEntries(Object.entries(p).filter(([k, v]) => !(typeof v === "string" && isSealed(v) && sealedKeys.includes(k))));
      const sealedAlready = Object.fromEntries(Object.entries(p).filter(([k]) => !(k in keep)));
      await tx.dealEvent.update({ where: { id: e.id }, data: { payload: { ...sealPayload(e.deal_id, keep), ...sealedAlready } as Prisma.InputJsonObject } });
      n++;
    }
    await tx.$executeRawUnsafe(`ALTER TABLE "deal_events" ENABLE TRIGGER "deal_events_no_update_delete"`);
    return n;
  }, { timeout: 300_000 });
}

export async function reseal(db: Db, opts: { sealPlaintextEvents?: boolean } = {}): Promise<{ deals: number; values: number; event_kids: string[]; events_sealed: number }> {
  const events_sealed = opts.sealPlaintextEvents ? await sealPlaintextEvents(db) : 0;
  const { active } = keyring();
  const stale = (v: string | Uint8Array) => kidOf(v) !== active;
  let deals = 0, values = 0;
  for (let cursor: string | undefined; ; ) {
    const page = await db.deal.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: BATCH, ...(cursor && { skip: 1, cursor: { id: cursor } }) });
    if (page.length === 0) break;
    for (const { id } of page) {
      values += await db.$transaction((tx) => resealDeal(tx, id, stale), { timeout: 60_000 });
      deals++;
    }
    cursor = page.at(-1)!.id;
  }
  // Event payloads cannot be rewritten: report the kids they still need.
  const kids = new Set<string>();
  for (let cursor: bigint | undefined; ; ) {
    const page = await db.dealEvent.findMany({ select: { id: true, payload: true }, orderBy: { id: "asc" }, take: 1000, ...(cursor && { skip: 1, cursor: { id: cursor } }) });
    if (page.length === 0) break;
    for (const e of page) {
      for (const k of EVENT_SEALED_KEYS) {
        const v = (e.payload as Record<string, unknown>)[k];
        if (typeof v === "string") kids.add(kidOf(v) ?? "plaintext (run with --seal-plaintext-events)");
      }
    }
    cursor = page.at(-1)!.id;
  }
  return { deals, values, event_kids: [...kids].sort(), events_sealed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.loadEnvFile(); } catch {} // .env is optional; Render injects env vars
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, options: "-c timezone=UTC" }) });
  reseal(prisma, { sealPlaintextEvents: process.argv.includes("--seal-plaintext-events") })
    .then((r) => console.log(`reseal: ${r.values} values in ${r.deals} deals now on ${keyring().active}; ${r.events_sealed} plaintext events sealed; event payloads still use: ${r.event_kids.join(", ") || "none"} (keep those kids in DATA_KEYS)`))
    .finally(() => prisma.$disconnect());
}
