// Terms rules that need no database (decisions D6, H3; 04 section 1.3; 06 "Terms versioning").
import { DealError } from "./errors";
import type { ConditionInput, DealStatus } from "./types";

export const CODE_CONDITION = (code: string) => `Photo shows the deal code ${code} written by hand`;
export const CODE_CONDITION_RE = /^Photo shows the deal code HS-[A-Z0-9]{4} written by hand$/;
export const isCodeCondition = (text: string) => CODE_CONDITION_RE.test(text);

/** D6: strips any code condition the buyer kept or moved, then re-appends this deal's one last, only when a photo condition remains. */
export function appendCodeCondition(code: string, conditions: ConditionInput[]): ConditionInput[] {
  const own = conditions.filter((c) => !isCodeCondition(c.text));
  return own.some((c) => c.evidence_type === "photo") ? [...own, { text: CODE_CONDITION(code), evidence_type: "photo" }] : own;
}

export type TermsInput = { item_title: string; amount_minor: number | null; deadline_days: number | null; conditions: ConditionInput[] };

/** The H3 / 04 section 1.3 limits; counts only non-code conditions (1 to 4). Throws invalid_input. */
export function validateTerms(input: TermsInput): void {
  const bad = (msg: string) => new DealError("invalid_input", msg);
  if (input.item_title.length < 1 || input.item_title.length > 80) throw bad("item_title must be 1 to 80 characters.");
  if (input.amount_minor !== null && !(Number.isInteger(input.amount_minor) && input.amount_minor >= 1 && input.amount_minor <= 1_000_000)) {
    throw bad("amount_minor must be 1 to 1,000,000.");
  }
  if (input.deadline_days !== null && !(Number.isInteger(input.deadline_days) && input.deadline_days >= 1 && input.deadline_days <= 21)) {
    throw bad("deadline_days must be 1 to 21.");
  }
  const own = input.conditions.filter((c) => !isCodeCondition(c.text));
  if (own.length < 1 || own.length > 4) throw bad("1 to 4 conditions are required.");
  if (own.some((c) => c.text.length < 1 || c.text.length > 200)) throw bad("Each condition must be 1 to 200 characters.");
}

/** terms_agreed only when both parties accepted the current version (C2). */
export function acceptanceOutcome(d: { terms_version: number; buyer_accepted_version: number | null; seller_accepted_version: number | null }): DealStatus {
  return d.buyer_accepted_version === d.terms_version && d.seller_accepted_version === d.terms_version ? "terms_agreed" : "draft";
}
