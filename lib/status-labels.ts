// The one place the eight status labels live (09 section 4.2; 08 section 2). `captured` reads "Payment released".
import type { DealStatus } from "@/lib/deal/types";

export type { DealStatus };

export const STATUS_ORDER: DealStatus[] = [
  "draft", "terms_agreed", "held", "proof_submitted", "in_review", "captured", "paid", "voided",
];

export const STATUS_LABEL: Record<DealStatus, string> = {
  draft: "Draft",
  terms_agreed: "Terms agreed",
  held: "Money held",
  proof_submitted: "Checking proof",
  in_review: "Buyer review",
  captured: "Payment released",
  paid: "Paid",
  voided: "Voided",
};
