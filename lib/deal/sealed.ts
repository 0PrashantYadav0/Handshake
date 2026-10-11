// Contract data sealed at rest (trust spec §5): every deal-owned column is bound to its deal ("<table>.<column>:<deal id>").
// Writers seal with the helpers below; readers go through openDealRow, so everything above the loader sees plain values.
import type { Prisma } from "@/generated/prisma/client";
import { aad, open, openBytes, openJson, seal, sealBytes, sealJson } from "@/lib/crypto/seal";

type Column = "deals.source_text" | "deals.item_title" | "conditions.text" | "evidence.value" | "verdicts.reason";

export const sealText = (column: Column, dealId: string, v: string) => seal(v, aad(column, dealId));
export const openText = (column: Column, dealId: string, v: string) => open(v, aad(column, dealId));
export const sealFile = (dealId: string, bytes: Uint8Array) => sealBytes(bytes, aad("files.bytes", dealId));
export const openFile = (dealId: string, bytes: Uint8Array) => openBytes(bytes, aad("files.bytes", dealId));
export const sealRaw = (dealId: string, v: unknown) => sealJson(v, aad("verdicts.raw_response", dealId)) as Prisma.InputJsonObject;
export const openRaw = (dealId: string, v: Prisma.JsonValue) => openJson(v, aad("verdicts.raw_response", dealId)) as Prisma.JsonValue;

/** deal_events.payload keys that carry contract content; each is sealed on its own so the rest of the payload stays queryable. */
export const EVENT_SEALED_KEYS = ["source_text", "note", "tracking_number", "item_title"] as const;

/** Structured payload keys with contract content (the create event's rejected sentence fragments), sealed as JSON text. */
export const EVENT_SEALED_JSON_KEYS = ["rejected"] as const;

function mapPayload(dealId: string, payload: unknown, f: (v: string, binding: string) => string): Record<string, unknown> {
  const out = { ...(payload as Record<string, unknown>) };
  for (const k of EVENT_SEALED_KEYS) {
    const v = out[k];
    if (typeof v === "string") out[k] = f(v, aad(`deal_events.payload.${k}`, dealId));
  }
  return out;
}
export function sealPayload(dealId: string, payload: Record<string, unknown>): Prisma.InputJsonObject {
  const out = mapPayload(dealId, payload, seal);
  for (const k of EVENT_SEALED_JSON_KEYS) if (out[k] !== undefined) out[k] = seal(JSON.stringify(out[k]), aad(`deal_events.payload.${k}`, dealId));
  return out as Prisma.InputJsonObject;
}
export function openPayload(dealId: string, payload: unknown): Prisma.JsonObject {
  const out = mapPayload(dealId, payload, open);
  for (const k of EVENT_SEALED_JSON_KEYS) if (typeof out[k] === "string") out[k] = JSON.parse(open(out[k] as string, aad(`deal_events.payload.${k}`, dealId)));
  return out as Prisma.JsonObject;
}

export function openVerdict<V extends { reason: string; raw_response: Prisma.JsonValue }>(dealId: string, v: V): V {
  return { ...v, reason: openText("verdicts.reason", dealId, v.reason), raw_response: openRaw(dealId, v.raw_response) };
}

type Sealed = {
  id: string; source_text: string; item_title: string;
  conditions?: { text: string }[]; evidence?: { value: string | null }[];
  verdicts?: { reason: string; raw_response: Prisma.JsonValue }[]; events?: { payload: Prisma.JsonValue }[];
};

/** The one opener for a deal row and whichever sealed relations it was loaded with. Throws SealError (a 500) on anything not sealed for this deal. */
export function openDealRow<T extends Sealed>(d: T): T {
  const id = d.id;
  return {
    ...d,
    source_text: openText("deals.source_text", id, d.source_text),
    item_title: openText("deals.item_title", id, d.item_title),
    ...(d.conditions && { conditions: d.conditions.map((c) => ({ ...c, text: openText("conditions.text", id, c.text) })) }),
    ...(d.evidence && { evidence: d.evidence.map((e) => ({ ...e, value: e.value === null ? null : openText("evidence.value", id, e.value) })) }),
    ...(d.verdicts && { verdicts: d.verdicts.map((v) => openVerdict(id, v)) }),
    ...(d.events && { events: d.events.map((e) => ({ ...e, payload: openPayload(id, e.payload) })) }),
  };
}
