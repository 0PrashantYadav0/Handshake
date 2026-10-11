// Zod bodies for the deal routes (04 sections 6 to 9, 1.3 limits; 06 "Zod schemas"). Deal-dependent rules stay in lib/deal.
import { z } from "zod";

export const CreateDeal = z.object({ text: z.string().min(1).max(500) });

const Condition = z.object({ text: z.string().min(1).max(200), evidence_type: z.enum(["photo", "tracking"]) });

export const Terms = z
  .object({
    item_title: z.string().min(1).max(80).optional(),
    amount_minor: z.number().int().min(1).max(1_000_000).optional(),
    deadline_days: z.number().int().min(1).max(21).optional(),
    conditions: z.array(Condition).min(1).max(4).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Send at least one of item_title, amount_minor, deadline_days, conditions.");

// trust spec §6: the signature over the contract hash, the device public key, and the step-up code.
const B64URL = (n: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${n}}$`), "base64url");
export const Accept = z.object({
  terms_version: z.number().int().min(1),
  contract_hash: z.string().regex(/^[0-9a-f]{64}$/, "sha-256 hex"),
  signature: B64URL(86),
  public_key: z.object({ x: B64URL(43), y: B64URL(43) }),
  totp: z.string().max(12).optional(),
});

export const Authorize = z.object({ order_id: z.string().min(1) });

export const Evidence = z.object({
  file_ids: z.array(z.string()),
  tracking_number: z.string().min(1).max(64).optional(),
  note: z.string().min(1).max(1000).optional(),
});

export const Review = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().min(1).max(1000).optional() });

export const Purpose = z.enum(["reference", "evidence"]);

export const FileQuery = z.object({ exp: z.string().regex(/^\d+$/), sig: z.string().regex(/^[A-Za-z0-9_-]+$/) });
