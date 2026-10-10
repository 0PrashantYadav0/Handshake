// 05 sections 3.4 and 3.5. The API schema uses only the supported subset (type, properties, required,
// additionalProperties: false, enum, type-array nullables, description, items); Zod carries the rest (D2).
import { z } from "zod";

// Hand-written on purpose. Do NOT replace with zodOutputFormat() or messages.parse(): SDK 0.132.1 moves
// `enum` into the description and the grammar stops enforcing it (dependencies.md trap 14;
// docs/research/claude-api.md, Summary 7).
export const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["item_title", "amount_minor", "currency", "deadline_days", "conditions", "rejected"],
  properties: {
    item_title: { type: "string", description: "Noun phrase naming the item, at most 80 characters." },
    amount_minor: {
      type: ["integer", "null"],
      description: "Price in minor units of its currency (80.00 is 8000). null when no price is stated.",
    },
    currency: {
      type: ["string", "null"],
      description: "ISO 4217 code of the stated price (USD, EUR, GBP, ...). null when none is stated or implied.",
    },
    deadline_days: {
      type: ["integer", "null"],
      description: "Whole days from today for the seller to deliver proof, 1 to 21. null when not stated.",
    },
    conditions: {
      type: "array",
      description: "0 to 4 conditions a reviewer can decide from photos or a carrier status.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence_type"],
        properties: {
          text: { type: "string", description: "One short sentence stating a checkable fact." },
          evidence_type: { type: "string", enum: ["photo", "tracking"] },
        },
      },
    },
    rejected: {
      type: "array",
      description: "Parts of the sentence that cannot be checked from evidence, each with a checkable rewording.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "suggestion"],
        properties: {
          text: { type: "string", description: "The buyer's words." },
          suggestion: { type: "string", description: "A photo or tracking condition that captures the intent." },
        },
      },
    },
  },
} as const;

const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);
const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);
/** Out-of-range or non-integer values become null (the UI asks; 05 Assumption 3). */
const intOrNull = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null), z.number().int().nullable());

export const ExtractZ = z.object({
  item_title: z.string().transform((s) => s.trim().slice(0, 80)).pipe(z.string().min(1)),
  amount_minor: intOrNull(1, 1_000_000), // H3
  currency: z.preprocess(upper, z.string().min(3).max(3).nullable()),
  deadline_days: intOrNull(1, 21), // I3
  conditions: z.array(
    z.object({
      text: z.string().transform((s) => s.trim().replace(/\s+/g, " ")).pipe(z.string().min(1).max(200)),
      evidence_type: z.preprocess(lower, z.enum(["photo", "tracking"])),
    }),
  ),
  rejected: z.array(z.object({ text: z.string().trim(), suggestion: z.string().trim() })),
});
export type ExtractRaw = z.infer<typeof ExtractZ>;

// 05 sections 4.5 and 4.6. Labels are stable (c1..c5, r1..r4, e1..e6, tracking, note) so one grammar serves every deal.
export const CONDITION_IDS = ["c1", "c2", "c3", "c4", "c5"] as const;
export const EVIDENCE_IDS = ["e1", "e2", "e3", "e4", "e5", "e6", "r1", "r2", "r3", "r4", "tracking", "note"] as const;

export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      minItems: 1,
      description: "Exactly one verdict per condition id, in the order given.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition_id", "result", "confidence", "reason", "evidence_used"],
        properties: {
          condition_id: { type: "string", enum: CONDITION_IDS },
          result: { type: "string", enum: ["pass", "fail", "unclear"] },
          confidence: { type: "number", description: "0.0 to 1.0." },
          reason: { type: "string", description: "One plain sentence, at most 200 characters, naming what was compared." },
          evidence_used: { type: "array", items: { type: "string", enum: EVIDENCE_IDS } },
        },
      },
    },
  },
} as const;

/** Clamped, never rejected; a non-number is 0. Not rounded: 0.8499 must stay below a 0.85 threshold (05 section 4.7). */
const clamp01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export const VerdictsZ = z.object({
  verdicts: z
    .array(
      z.object({
        // Looser than the grammar on purpose (06 "AI output validation"): a well-formed label the deal lacks (c9) is dropped
        // in judge(), an unknown evidence id (e7) is removed there too; anything else fails the call (the safe direction).
        condition_id: z.preprocess(lower, z.string().regex(/^c\d+$/)),
        result: z.preprocess(lower, z.enum(["pass", "fail", "unclear"])),
        confidence: z.preprocess(clamp01, z.number().min(0).max(1)),
        reason: z.string().transform((s) => s.trim().replace(/\s+/g, " ").slice(0, 300) || "No reason given."),
        evidence_used: z.array(z.preprocess(lower, z.string())),
      }),
    )
    .min(1),
});
export type VerdictsRaw = z.infer<typeof VerdictsZ>;
